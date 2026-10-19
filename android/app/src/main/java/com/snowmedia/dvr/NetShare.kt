package com.snowmedia.dvr

import android.content.Context
import com.hierynomus.msdtyp.AccessMask
import com.hierynomus.mserref.NtStatus
import com.hierynomus.msfscc.FileAttributes
import com.hierynomus.msfscc.fileinformation.FileStandardInformation
import com.hierynomus.mssmb2.SMB2CreateDisposition
import com.hierynomus.mssmb2.SMB2CreateOptions
import com.hierynomus.mssmb2.SMB2MessageCommandCode
import com.hierynomus.mssmb2.SMB2ShareAccess
import com.hierynomus.mssmb2.SMBApiException
import com.hierynomus.protocol.commons.EnumWithValue
import com.hierynomus.protocol.commons.socket.ProxySocketFactory
import com.hierynomus.protocol.transport.TransportException
import com.hierynomus.smbj.SMBClient
import com.hierynomus.smbj.SmbConfig
import com.hierynomus.smbj.auth.AuthenticationContext
import com.hierynomus.smbj.auth.NtlmAuthenticator
import com.hierynomus.smbj.connection.Connection
import com.hierynomus.smbj.session.SMB2GuestSigningRequiredException
import com.hierynomus.smbj.session.Session
import com.hierynomus.smbj.share.DiskShare
import com.hierynomus.smbj.share.File as SmbFile
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.SecureRandom
import java.util.EnumSet
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit

/** Why a network folder can't be used, as the TV screen receives it. */
internal object NetReason {
    const val UNREACHABLE = "unreachable"
    const val AUTH = "auth"
    const val NO_SHARE = "no_share"
    const val NO_FOLDER = "no_folder"
    const val READ_ONLY = "read_only"
    const val ERROR = "error"
}

/** Which step a failure happened in: the same status means different things at different steps. */
internal enum class NetStage { CONNECT, AUTH, SHARE, FOLDER, WRITE }

/** A failure with its reason already worked out. The message is the reason only: never a host, path or user. */
internal class NetFailure(val reason: String, cause: Throwable? = null) : IOException(reason, cause)

/**
 * SMB errors as the plain reasons the TV screen shows. Pure (works on any
 * Throwable chain), so NetShareErrorsTest covers it.
 */
internal object NetErrors {
    // Sign-in refused for the account itself. Some are not in smbj's NtStatus list, so by number.
    private val AUTH_CODES = setOf(
        NtStatus.STATUS_LOGON_FAILURE.value,
        NtStatus.STATUS_ACCOUNT_DISABLED.value,
        NtStatus.STATUS_PASSWORD_EXPIRED.value,
        NtStatus.STATUS_LOGON_TYPE_NOT_GRANTED.value,
        0xC000006EL, // STATUS_ACCOUNT_RESTRICTION (e.g. a blank password over the network)
        0xC000006FL, // STATUS_INVALID_LOGON_HOURS
        0xC0000070L, // STATUS_INVALID_WORKSTATION
        0xC0000193L, // STATUS_ACCOUNT_EXPIRED
        0xC0000224L, // STATUS_PASSWORD_MUST_CHANGE
        0xC0000234L, // STATUS_ACCOUNT_LOCKED_OUT
        0xC0000413L, // STATUS_AUTHENTICATION_FIREWALL_FAILED
    )
    private val NOT_FOUND_CODES = setOf(
        NtStatus.STATUS_OBJECT_PATH_NOT_FOUND.value,
        NtStatus.STATUS_OBJECT_NAME_NOT_FOUND.value,
        NtStatus.STATUS_OBJECT_NAME_INVALID.value,
        NtStatus.STATUS_OBJECT_NAME_COLLISION.value,
        NtStatus.STATUS_NOT_A_DIRECTORY.value,
        NtStatus.STATUS_FILE_IS_A_DIRECTORY.value,
        NtStatus.STATUS_NAME_TOO_LONG.value,
        NtStatus.STATUS_NO_SUCH_FILE.value,
    )
    private const val STATUS_MEDIA_WRITE_PROTECTED = 0xC00000A2L
    /** The file itself isn't there any more, or is on its way out (deleted while someone still had it open). */
    private val GONE_CODES = setOf(
        NtStatus.STATUS_OBJECT_NAME_NOT_FOUND.value,
        NtStatus.STATUS_OBJECT_PATH_NOT_FOUND.value,
        NtStatus.STATUS_NO_SUCH_FILE.value,
        NtStatus.STATUS_DELETE_PENDING.value,
        NtStatus.STATUS_FILE_DELETED.value,
    )
    /** Trouble with the whole share (or the sign-in), as opposed to one file. */
    private val SHARE_CODES = setOf(
        NtStatus.STATUS_DISK_FULL.value,
        NtStatus.STATUS_BAD_NETWORK_NAME.value,
        NtStatus.STATUS_BAD_NETWORK_PATH.value,
        NtStatus.STATUS_INSUFF_SERVER_RESOURCES.value,
        NtStatus.STATUS_VOLUME_DISMOUNTED.value,
    )
    private val LOST_CODES = setOf(
        NtStatus.STATUS_NETWORK_SESSION_EXPIRED.value,
        NtStatus.STATUS_USER_SESSION_DELETED.value,
        NtStatus.STATUS_NETWORK_NAME_DELETED.value,
        NtStatus.STATUS_CONNECTION_DISCONNECTED.value,
        NtStatus.STATUS_CONNECTION_RESET.value,
        NtStatus.STATUS_FILE_CLOSED.value,
    )

    private fun chain(t: Throwable): Sequence<Throwable> = generateSequence(t) { c -> c.cause?.takeIf { it !== c } }.take(12)

    /** The SMB status in [t]'s chain, if there is one. */
    fun statusOf(t: Throwable): Long? = chain(t).filterIsInstance<SMBApiException>().firstOrNull()?.statusCode

    fun reason(t: Throwable, stage: NetStage): String {
        chain(t).filterIsInstance<NetFailure>().firstOrNull()?.let { return it.reason }
        if (chain(t).any { it is SMB2GuestSigningRequiredException }) return NetReason.AUTH
        val api = chain(t).filterIsInstance<SMBApiException>().firstOrNull()
        if (api != null) {
            val code = api.statusCode
            val cmd = api.failedCommand
            return when {
                code in AUTH_CODES -> NetReason.AUTH
                code == NtStatus.STATUS_BAD_NETWORK_NAME.value -> NetReason.NO_SHARE
                code == NtStatus.STATUS_BAD_NETWORK_PATH.value -> NetReason.UNREACHABLE
                code == NtStatus.STATUS_ACCESS_DENIED.value -> when {
                    // Refused at sign-in although the password was right: the computer demands encryption,
                    // which this app does not offer (SmbSecurity). Reported as an error, not a wrong password.
                    cmd == SMB2MessageCommandCode.SMB2_SESSION_SETUP || stage == NetStage.AUTH -> NetReason.ERROR
                    // This account may not open the share (or the share demands encryption: indistinguishable).
                    cmd == SMB2MessageCommandCode.SMB2_TREE_CONNECT || stage == NetStage.SHARE -> NetReason.AUTH
                    else -> NetReason.READ_ONLY
                }
                code == STATUS_MEDIA_WRITE_PROTECTED -> NetReason.READ_ONLY
                code in NOT_FOUND_CODES -> if (stage == NetStage.SHARE) NetReason.NO_SHARE else NetReason.NO_FOLDER
                code in LOST_CODES -> NetReason.UNREACHABLE
                else -> NetReason.ERROR
            }
        }
        if (chain(t).any { it is UnknownHostException || it is ConnectException || it is NoRouteToHostException || it is SocketTimeoutException }) {
            return NetReason.UNREACHABLE
        }
        if (chain(t).any { it is TransportException || it is SocketException || it is InterruptedIOException }) return NetReason.UNREACHABLE
        // Couldn't even reach the SMB layer (e.g. not an SMB server on that port).
        if (stage == NetStage.CONNECT) return NetReason.UNREACHABLE
        return NetReason.ERROR
    }

    /** The connection or session went away under us: worth one retry on a fresh one. */
    fun isConnectionLost(t: Throwable): Boolean {
        val code = statusOf(t)
        if (code != null) return code in LOST_CODES
        return chain(t).any { it is TransportException || it is SocketException || it is InterruptedIOException }
    }

    fun isNotFound(t: Throwable): Boolean {
        val code = statusOf(t) ?: return false
        return code == NtStatus.STATUS_OBJECT_NAME_NOT_FOUND.value || code == NtStatus.STATUS_OBJECT_PATH_NOT_FOUND.value ||
            code == NtStatus.STATUS_NO_SUCH_FILE.value
    }

    /** The recording's file on the share went away (renamed, moved or deleted on the computer). */
    fun isGone(t: Throwable): Boolean = statusOf(t)?.let { it in GONE_CODES } == true

    enum class Scope { SHARE, FILE }

    /**
     * Whether an upload failure is the share's (unreachable, signed out,
     * full: every recording waits) or one file's (the viewer has it open on
     * the computer, no right to write that file, a lock: only that recording
     * waits, the others carry on). Unknown SMB answers count as the file's;
     * anything that isn't an SMB answer (a lost connection) as the share's.
     */
    fun uploadScope(t: Throwable): Scope {
        if (chain(t).any { it is NetFailure }) return Scope.SHARE // could not open the share or its folder
        if (isConnectionLost(t)) return Scope.SHARE
        if (chain(t).any { it is SMB2GuestSigningRequiredException }) return Scope.SHARE
        val api = chain(t).filterIsInstance<SMBApiException>().firstOrNull()
        if (api == null) {
            // Reading the chunk on the box failed: that file's problem.
            if (chain(t).any { it is java.io.FileNotFoundException }) return Scope.FILE
            return if (chain(t).any { it is UnknownHostException || it is ConnectException || it is NoRouteToHostException || it is SocketTimeoutException }) {
                Scope.SHARE
            } else Scope.FILE
        }
        val code = api.statusCode
        val cmd = api.failedCommand
        return when {
            code in SHARE_CODES || code in AUTH_CODES -> Scope.SHARE
            cmd == SMB2MessageCommandCode.SMB2_SESSION_SETUP || cmd == SMB2MessageCommandCode.SMB2_TREE_CONNECT -> Scope.SHARE
            else -> Scope.FILE
        }
    }

    fun isNameTaken(t: Throwable): Boolean = statusOf(t) == NtStatus.STATUS_OBJECT_NAME_COLLISION.value

    fun isDiskFull(t: Throwable): Boolean = statusOf(t) == NtStatus.STATUS_DISK_FULL.value
}

/** A share opened for one network folder: the connection, a signed-in session, the share. Close when done. */
internal class NetConn(
    val folder: NetFolder,
    private val connection: Connection,
    private val session: Session,
    val share: DiskShare,
) : Closeable {
    /** Bytes per read request: what the computer allows, at most 1 MB. */
    val readChunk: Int = try {
        connection.negotiatedProtocol.maxReadSize.coerceIn(64 * 1024, 1 shl 20)
    } catch (_: Throwable) {
        64 * 1024
    }
    @Volatile var lastUsed = System.currentTimeMillis()
    /** Calls running on it right now: an idle-replacement never closes it under them. */
    val users = java.util.concurrent.atomic.AtomicInteger(0)

    val alive: Boolean get() = try { connection.isConnected && share.isConnected } catch (_: Throwable) { false }

    fun path(name: String = ""): String = NetFolderRules.smbPath(folder.folder, name)

    /**
     * Ends it. [force]: just drop the socket. Saying goodbye (tree
     * disconnect, logoff) to a computer that went to sleep waits out every
     * request timeout, 60-90 s, so a connection that is dead or may be is
     * forced, and either way [NetShare.closeLater] does it off the caller's thread.
     */
    fun close(force: Boolean) {
        if (!force) {
            try { share.close() } catch (_: Throwable) { /* gone already */ }
            try { session.close() } catch (_: Throwable) { /* gone already */ }
        }
        // Each NetConn has its own client and connection (NetShare.open), so this never cuts anyone else's.
        try { connection.close(true) } catch (_: Throwable) { /* gone already */ }
    }

    override fun close() = close(false)
}

/**
 * Talks to the network folder (smbj, SMB 2.0.2 to 3.1.1, NTLM sign-in;
 * signing whenever the computer asks for it, which Windows 11 does). Short
 * timeouts: 5 s to connect, 30 s for any one request.
 *
 * Nothing here logs a host, share, path, user name or password; failures
 * become a [NetReason] and only an exception's class name ever reaches a log.
 */
internal object NetShare {
    const val CONNECT_TIMEOUT_MS = 5_000
    const val IO_TIMEOUT_S = 30L
    /** The share keeps this much free: under it a recording stops ("The drive is full") and a new one is refused. */
    const val SHARE_MIN_FREE_BYTES = 1L shl 30
    /** A cached connection unused for this long is replaced rather than trusted (a computer that went to sleep). */
    private const val IDLE_MS = 120_000L

    private val random = SecureRandom()
    /** Where connections are closed: never on the caller's thread, never under [cacheLock] (see NetConn.close). */
    private val closer = Executors.newCachedThreadPool { r -> Thread(r, "smc-net-close").apply { isDaemon = true } }

    fun closeLater(c: NetConn, force: Boolean) {
        try { closer.execute { c.close(force) } } catch (_: Throwable) { /* shutting down */ }
    }

    private fun closeLater(block: () -> Unit) {
        try { closer.execute { try { block() } catch (_: Throwable) { /* gone already */ } } } catch (_: Throwable) { /* shutting down */ }
    }

    fun config(): SmbConfig = SmbConfig.builder()
        .withSecurityProvider(SmbSecurity())
        // NTLM only, the same on every box (no Kerberos: a home computer has no domain controller).
        .withAuthenticators(listOf<com.hierynomus.protocol.commons.Factory.Named<com.hierynomus.smbj.auth.Authenticator>>(NtlmAuthenticator.Factory()))
        .withSigningEnabled(true)
        .withSigningRequired(false)
        // Never negotiated, so never needed: see SmbSecurity.
        .withEncryptData(false)
        .withDfsEnabled(false)
        .withSocketFactory(ProxySocketFactory(CONNECT_TIMEOUT_MS))
        .withTimeout(IO_TIMEOUT_S, TimeUnit.SECONDS)
        .build()

    /**
     * Connects and signs in to [f] (each step's failure as a [NetFailure]
     * with its reason). Every call gets a client and a TCP connection of its
     * own: smbj's client would otherwise hand back the pooled connection a
     * replacement is meant to get away from, and closing one would cut the other.
     */
    fun open(f: NetFolder, password: String?): NetConn {
        val connection = try {
            SMBClient(config()).connect(f.host, f.port)
        } catch (t: Throwable) {
            throw NetFailure(NetErrors.reason(t, NetStage.CONNECT), t)
        }
        val session = try {
            val auth = if (f.user.isEmpty()) AuthenticationContext.anonymous()
            else AuthenticationContext(f.user, (password ?: "").toCharArray(), f.domain.ifEmpty { null })
            connection.authenticate(auth)
        } catch (t: Throwable) {
            closeLater { connection.close(true) }
            throw NetFailure(NetErrors.reason(t, NetStage.AUTH), t)
        }
        val share = try {
            session.connectShare(f.share) as? DiskShare ?: throw NetFailure(NetReason.NO_SHARE)
        } catch (t: Throwable) {
            closeLater { try { session.close() } finally { connection.close(true) } }
            throw if (t is NetFailure) t else NetFailure(NetErrors.reason(t, NetStage.SHARE), t)
        }
        return NetConn(f, connection, session, share)
    }

    /** Creates the folder (and its parents inside the share) when missing. */
    fun ensureFolder(c: NetConn) {
        try {
            var path = ""
            for (p in c.folder.folder.split('/').filter { it.isNotEmpty() }) {
                path = if (path.isEmpty()) p else "$path\\$p"
                if (!folderThere(c, path)) {
                    try { c.share.mkdir(path) } catch (e: SMBApiException) { if (!NetErrors.isNameTaken(e)) throw e }
                }
            }
        } catch (t: Throwable) {
            throw if (t is NetFailure) t else NetFailure(NetErrors.reason(t, NetStage.FOLDER), t)
        }
    }

    /**
     * Below the share's floor: stop recordings to it. A total of 0 means the
     * server didn't say (some don't report volume sizes): unknown is not full. Pure.
     */
    fun isShareFull(free: Long, total: Long): Boolean = total > 0 && free in 0 until SHARE_MIN_FREE_BYTES

    /** Free and total bytes of the share (what this account may use). */
    fun space(c: NetConn): Pair<Long, Long> {
        val info = c.share.shareInformation
        val free = info.callerFreeSpace.takeIf { it > 0 } ?: info.freeSpace
        return free to info.totalSpace
    }

    data class TestResult(val ok: Boolean, val reason: String? = null, val freeBytes: Long = 0L, val totalBytes: Long = 0L)

    /**
     * Can recordings go to [f]? Connects, signs in, opens the share, creates
     * the folder when missing, then writes and deletes a tiny hidden file.
     * Saves nothing. On success the status cache learns the free space.
     */
    fun test(f: NetFolder, password: String?): TestResult {
        var c: NetConn? = null
        var failed: Throwable? = null
        return try {
            c = open(f, password)
            ensureFolder(c)
            try { probe(c) } catch (t: Throwable) { throw NetFailure(NetErrors.reason(t, NetStage.WRITE), t) }
            val (free, total) = try { space(c) } catch (_: Throwable) { 0L to 0L }
            NetStatus.record(f.key, true, free, total)
            TestResult(true, null, free, total)
        } catch (t: Throwable) {
            failed = t
            TestResult(false, NetErrors.reason(t, NetStage.WRITE))
        } finally {
            // The answer goes back at once; the goodbye happens in the background.
            c?.let { closeLater(it, force = failed?.let { f -> NetErrors.isConnectionLost(f) } == true) }
        }
    }

    private fun probe(c: NetConn) {
        val name = ".smc-probe-" + java.lang.Long.toHexString(random.nextLong()) + ".tmp"
        val f = c.share.openFile(
            c.path(name),
            EnumSet.of(AccessMask.GENERIC_WRITE, AccessMask.DELETE),
            EnumSet.of(FileAttributes.FILE_ATTRIBUTE_HIDDEN),
            EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ),
            SMB2CreateDisposition.FILE_CREATE,
            EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
        )
        try {
            f.write(PROBE, 0L)
        } finally {
            try { f.deleteOnClose() } catch (_: Throwable) { /* the close below still happens */ }
            f.close()
        }
    }

    private val PROBE = "Snow Media Center write test\n".toByteArray(Charsets.US_ASCII)

    // ---- the shared connection for the saved folder ----

    private val cacheLock = Any()
    private var cached: NetConn? = null

    private fun shared(ctx: Context): NetConn = synchronized(cacheLock) {
        val f = NetFolderStore.read(ctx) ?: throw NetFailure(NetReason.ERROR)
        val c = cached
        val idle = c != null && c.users.get() == 0 && System.currentTimeMillis() - c.lastUsed >= IDLE_MS
        if (c != null && c.folder.key == f.key && c.alive && !idle) {
            c.lastUsed = System.currentTimeMillis()
            c.users.incrementAndGet()
            return c
        }
        cached = null
        // Dead or idle (maybe half-open after the computer slept): just dropped. Another folder: a proper goodbye.
        if (c != null) closeLater(c, force = !c.alive || idle)
        val n = open(f, NetFolderStore.password(ctx))
        n.users.incrementAndGet()
        cached = n
        n
    }

    private fun drop(c: NetConn) {
        synchronized(cacheLock) { if (cached === c) cached = null }
        closeLater(c, force = true)
    }

    /** Forget the shared connection (the folder was saved again or cleared). Never waits on the network. */
    fun invalidate() {
        val c = synchronized(cacheLock) { cached.also { cached = null } }
        if (c != null) closeLater(c, force = !c.alive)
    }

    /**
     * Runs [block] on the saved folder's share, connecting when needed; a
     * connection that turns out dead is replaced once. Throws [NetFailure]
     * when there is no saved folder or it can't be reached.
     */
    fun <T> withShare(ctx: Context, block: (NetConn) -> T): T {
        var retried = false
        while (true) {
            val c = shared(ctx) // counted as a user until the finally below
            try {
                return block(c)
            } catch (t: Throwable) {
                if (NetErrors.isConnectionLost(t)) {
                    drop(c)
                    if (!retried) { retried = true; continue }
                }
                throw t
            } finally {
                c.lastUsed = System.currentTimeMillis()
                c.users.decrementAndGet()
            }
        }
    }

    // ---- files ----

    data class RemoteFile(val name: String, val bytes: Long, val modifiedMs: Long)

    /** The recordings (*.ts) in the folder; empty when the folder doesn't exist yet. */
    fun listRecordings(c: NetConn): List<RemoteFile> {
        val entries = try {
            c.share.list(c.path(), "*.ts")
        } catch (e: SMBApiException) {
            if (NetErrors.isNotFound(e)) return emptyList()
            throw e
        }
        return entries.filter {
            !EnumWithValue.EnumUtils.isSet(it.fileAttributes, FileAttributes.FILE_ATTRIBUTE_DIRECTORY) &&
                NetPathGuard.isRecordingName(it.fileName)
        }.map { RemoteFile(it.fileName, it.endOfFile, it.lastWriteTime.toEpochMillis()) }
    }

    /** [name] in the folder, with " (2)", " (3)"… when it is taken, like RecordingStore.uniqueFile. */
    fun uniqueName(c: NetConn, name: String, alsoTaken: Set<String> = emptySet()): String {
        val base = name.removeSuffix(".ts")
        var candidate = name
        var n = 2
        while (n < 1000 && (alsoTaken.any { it.equals(candidate, ignoreCase = true) } || fileThere(c, c.path(candidate)))) {
            candidate = "$base ($n).ts"
            n++
        }
        return candidate
    }

    /** Creates [name] empty; fails (name taken) if it exists, so two boxes never write into one file. */
    fun createNew(c: NetConn, name: String) {
        c.share.openFile(
            c.path(name),
            EnumSet.of(AccessMask.GENERIC_WRITE),
            EnumSet.of(FileAttributes.FILE_ATTRIBUTE_NORMAL),
            EnumSet.of(SMB2ShareAccess.FILE_SHARE_READ),
            SMB2CreateDisposition.FILE_CREATE,
            EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
        ).close()
    }

    /**
     * Writes the whole of [local] into [name] at [offset] (the size the
     * remote file had after the last chunk: writing there again after a
     * crash replaces a half-written chunk instead of doubling it).
     */
    fun writeAt(c: NetConn, name: String, offset: Long, local: File) {
        val f = c.share.openFile(
            c.path(name),
            EnumSet.of(AccessMask.GENERIC_WRITE),
            EnumSet.of(FileAttributes.FILE_ATTRIBUTE_NORMAL),
            SMB2ShareAccess.ALL,
            SMB2CreateDisposition.FILE_OPEN,
            EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
        )
        try {
            FileInputStream(local).use { input ->
                val buf = ByteArray(1 shl 20)
                var pos = offset
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    if (n > 0) {
                        f.write(buf, pos, 0, n)
                        pos += n
                    }
                }
            }
        } finally {
            f.close()
        }
    }

    /** Opens [name] for reading; the caller closes it. */
    fun openRead(c: NetConn, name: String): SmbFile = c.share.openFile(
        c.path(name),
        EnumSet.of(AccessMask.GENERIC_READ),
        EnumSet.of(FileAttributes.FILE_ATTRIBUTE_NORMAL),
        SMB2ShareAccess.ALL,
        SMB2CreateDisposition.FILE_OPEN,
        EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
    )

    fun sizeOf(f: SmbFile): Long = f.getFileInformation(FileStandardInformation::class.java).endOfFile

    fun exists(c: NetConn, name: String): Boolean = fileThere(c, c.path(name))

    // Some servers (impacket, some NAS) answer a missing file or folder with
    // "no such file" where Windows says "not found"; smbj's exists checks
    // only take the latter as false and throw on the former.
    private fun missing(e: SMBApiException) = e.status == NtStatus.STATUS_NO_SUCH_FILE
    private fun fileThere(c: NetConn, path: String): Boolean =
        try { c.share.fileExists(path) } catch (e: SMBApiException) { if (missing(e)) false else throw e }
    private fun folderThere(c: NetConn, path: String): Boolean =
        try { c.share.folderExists(path) } catch (e: SMBApiException) { if (missing(e)) false else throw e }

    /** Renames [from] to [to] in the folder; never replaces a file that exists. */
    fun rename(c: NetConn, from: String, to: String) {
        val f = c.share.openFile(
            c.path(from),
            EnumSet.of(AccessMask.DELETE, AccessMask.FILE_READ_ATTRIBUTES),
            EnumSet.of(FileAttributes.FILE_ATTRIBUTE_NORMAL),
            SMB2ShareAccess.ALL,
            SMB2CreateDisposition.FILE_OPEN,
            EnumSet.of(SMB2CreateOptions.FILE_NON_DIRECTORY_FILE),
        )
        try { f.rename(c.path(to), false) } finally { f.close() }
    }

    fun remove(c: NetConn, name: String) = c.share.rm(c.path(name))
}

/**
 * What is known about the saved folder's reachability and free space,
 * refreshed in the background at most once a minute (getVolumes never waits
 * on the network for more than about 2 s). The uploader and a successful
 * test feed it too.
 */
internal object NetStatus {
    class Snapshot(val key: String, val reachable: Boolean, val freeBytes: Long, val totalBytes: Long, val atMs: Long)

    private const val FRESH_MS = 60_000L
    @Volatile private var last: Snapshot? = null
    private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "smc-net-status").apply { isDaemon = true } }
    private val lock = Any()
    private var inFlight: Future<*>? = null

    fun record(key: String, reachable: Boolean, free: Long = -1L, total: Long = -1L) {
        val prev = last?.takeIf { it.key == key }
        last = Snapshot(
            key, reachable,
            if (free >= 0) free else prev?.freeBytes ?: 0L,
            if (total >= 0) total else prev?.totalBytes ?: 0L,
            System.currentTimeMillis(),
        )
    }

    fun peek(key: String): Snapshot? = last?.takeIf { it.key == key }

    fun forget() { last = null }

    /** The snapshot for [f], refreshed first if older than a minute (waiting at most [waitMs] for it). */
    fun current(ctx: Context, f: NetFolder, waitMs: Long): Snapshot? {
        val s = peek(f.key)
        if (s != null && System.currentTimeMillis() - s.atMs < FRESH_MS) return s
        val fut = refresh(ctx)
        try { fut.get(waitMs, TimeUnit.MILLISECONDS) } catch (_: Throwable) { /* still running: the old snapshot (or none) for now */ }
        return peek(f.key)
    }

    fun refresh(ctx: Context): Future<*> = synchronized(lock) {
        inFlight?.takeIf { !it.isDone }?.let { return it }
        val app = ctx.applicationContext
        exec.submit {
            val f = NetFolderStore.read(app) ?: return@submit
            try {
                val (free, total) = NetShare.withShare(app) { NetShare.space(it) }
                record(f.key, true, free, total)
            } catch (_: Throwable) {
                record(f.key, false)
            }
        }.also { inFlight = it }
    }
}
