package com.snowmedia.dvr

import com.hierynomus.mserref.NtStatus
import com.hierynomus.mssmb2.SMB2MessageCommandCode
import com.hierynomus.mssmb2.SMBApiException
import com.hierynomus.protocol.transport.TransportException
import com.hierynomus.smbj.common.SMBRuntimeException
import com.hierynomus.smbj.session.SMB2GuestSigningRequiredException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** SMB failures as the reasons the TV screen shows (NetErrors). */
class NetShareErrorsTest {
    private fun api(status: NtStatus, cmd: SMB2MessageCommandCode) = SMBApiException(status.value, cmd, null)
    private fun api(code: Long, cmd: SMB2MessageCommandCode) = SMBApiException(code, cmd, null)

    @Test fun nobodyThere() {
        assertEquals(NetReason.UNREACHABLE, NetErrors.reason(UnknownHostException("x"), NetStage.CONNECT))
        assertEquals(NetReason.UNREACHABLE, NetErrors.reason(ConnectException("refused"), NetStage.CONNECT))
        assertEquals(NetReason.UNREACHABLE, NetErrors.reason(TransportException(SocketTimeoutException()), NetStage.CONNECT))
        // Something answered on the port but it wasn't SMB.
        assertEquals(NetReason.UNREACHABLE, NetErrors.reason(IllegalStateException("garbage"), NetStage.CONNECT))
        // A connection lost later is "unreachable" too.
        assertEquals(NetReason.UNREACHABLE, NetErrors.reason(SMBRuntimeException(TransportException("closed")), NetStage.WRITE))
    }

    @Test fun wrongPasswordOrAccount() {
        assertEquals(NetReason.AUTH, NetErrors.reason(api(NtStatus.STATUS_LOGON_FAILURE, SMB2MessageCommandCode.SMB2_SESSION_SETUP), NetStage.AUTH))
        assertEquals(NetReason.AUTH, NetErrors.reason(api(NtStatus.STATUS_ACCOUNT_DISABLED, SMB2MessageCommandCode.SMB2_SESSION_SETUP), NetStage.AUTH))
        assertEquals(NetReason.AUTH, NetErrors.reason(api(0xC0000234L, SMB2MessageCommandCode.SMB2_SESSION_SETUP), NetStage.AUTH))
        assertEquals(NetReason.AUTH, NetErrors.reason(api(0xC000006EL, SMB2MessageCommandCode.SMB2_SESSION_SETUP), NetStage.AUTH))
        // A guest sign-in on a computer that requires signing (Windows 11 refuses guests).
        assertEquals(NetReason.AUTH, NetErrors.reason(SMB2GuestSigningRequiredException(), NetStage.AUTH))
        // The account may not open this share.
        assertEquals(NetReason.AUTH, NetErrors.reason(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_TREE_CONNECT), NetStage.SHARE))
    }

    @Test fun accessDeniedAtSignInIsAnEncryptionDemandNotAPassword() {
        assertEquals(NetReason.ERROR, NetErrors.reason(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_SESSION_SETUP), NetStage.AUTH))
    }

    @Test fun shareAndFolder() {
        assertEquals(NetReason.NO_SHARE, NetErrors.reason(api(NtStatus.STATUS_BAD_NETWORK_NAME, SMB2MessageCommandCode.SMB2_TREE_CONNECT), NetStage.SHARE))
        assertEquals(NetReason.NO_FOLDER, NetErrors.reason(api(NtStatus.STATUS_OBJECT_PATH_NOT_FOUND, SMB2MessageCommandCode.SMB2_CREATE), NetStage.FOLDER))
        assertEquals(NetReason.NO_FOLDER, NetErrors.reason(api(NtStatus.STATUS_OBJECT_NAME_INVALID, SMB2MessageCommandCode.SMB2_CREATE), NetStage.FOLDER))
        // A file where the folder should be.
        assertEquals(NetReason.NO_FOLDER, NetErrors.reason(api(NtStatus.STATUS_NOT_A_DIRECTORY, SMB2MessageCommandCode.SMB2_CREATE), NetStage.WRITE))
    }

    @Test fun readOnly() {
        assertEquals(NetReason.READ_ONLY, NetErrors.reason(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_CREATE), NetStage.FOLDER))
        assertEquals(NetReason.READ_ONLY, NetErrors.reason(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_CREATE), NetStage.WRITE))
        assertEquals(NetReason.READ_ONLY, NetErrors.reason(api(0xC00000A2L, SMB2MessageCommandCode.SMB2_WRITE), NetStage.WRITE))
    }

    @Test fun aReasonAlreadyWorkedOutIsKept() {
        assertEquals(NetReason.NO_SHARE, NetErrors.reason(NetFailure(NetReason.NO_SHARE), NetStage.WRITE))
        assertEquals(NetReason.AUTH, NetErrors.reason(RuntimeException(NetFailure(NetReason.AUTH)), NetStage.WRITE))
        assertEquals(NetReason.ERROR, NetErrors.reason(api(NtStatus.STATUS_DISK_FULL, SMB2MessageCommandCode.SMB2_WRITE), NetStage.WRITE))
    }

    @Test fun whatIsWorthARetryOnAFreshConnection() {
        assertTrue(NetErrors.isConnectionLost(TransportException("closed")))
        assertTrue(NetErrors.isConnectionLost(SMBRuntimeException(TransportException("closed"))))
        assertTrue(NetErrors.isConnectionLost(api(NtStatus.STATUS_NETWORK_SESSION_EXPIRED, SMB2MessageCommandCode.SMB2_CREATE)))
        assertTrue(NetErrors.isConnectionLost(api(NtStatus.STATUS_USER_SESSION_DELETED, SMB2MessageCommandCode.SMB2_READ)))
        assertFalse(NetErrors.isConnectionLost(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_CREATE)))
        assertFalse(NetErrors.isConnectionLost(NetUserError("Recording not found")))
        assertFalse(NetErrors.isConnectionLost(NetFailure(NetReason.AUTH)))
    }

    @Test fun uploadProblemsOfOneFileOnlyHoldBackThatRecordingOnly() {
        val file = NetErrors.Scope.FILE
        val share = NetErrors.Scope.SHARE
        // The viewer is watching the growing file on the computer, or may not write that file.
        assertEquals(file, NetErrors.uploadScope(api(NtStatus.STATUS_SHARING_VIOLATION, SMB2MessageCommandCode.SMB2_CREATE)))
        assertEquals(file, NetErrors.uploadScope(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_CREATE)))
        assertEquals(file, NetErrors.uploadScope(api(NtStatus.STATUS_FILE_LOCK_CONFLICT, SMB2MessageCommandCode.SMB2_WRITE)))
        assertEquals(file, NetErrors.uploadScope(SMBRuntimeException(api(NtStatus.STATUS_DELETE_PENDING, SMB2MessageCommandCode.SMB2_CREATE))))
        assertEquals(file, NetErrors.uploadScope(java.io.FileNotFoundException("chunk")))
        // The share itself: unreachable, signed out, gone, full.
        assertEquals(share, NetErrors.uploadScope(NetFailure(NetReason.UNREACHABLE)))
        assertEquals(share, NetErrors.uploadScope(NetFailure(NetReason.READ_ONLY)))
        assertEquals(share, NetErrors.uploadScope(TransportException("closed")))
        assertEquals(share, NetErrors.uploadScope(SMBRuntimeException(TransportException(SocketTimeoutException()))))
        assertEquals(share, NetErrors.uploadScope(api(NtStatus.STATUS_NETWORK_SESSION_EXPIRED, SMB2MessageCommandCode.SMB2_WRITE)))
        assertEquals(share, NetErrors.uploadScope(api(NtStatus.STATUS_DISK_FULL, SMB2MessageCommandCode.SMB2_WRITE)))
        assertEquals(share, NetErrors.uploadScope(api(NtStatus.STATUS_ACCESS_DENIED, SMB2MessageCommandCode.SMB2_TREE_CONNECT)))
        assertEquals(share, NetErrors.uploadScope(api(NtStatus.STATUS_LOGON_FAILURE, SMB2MessageCommandCode.SMB2_SESSION_SETUP)))
    }

    @Test fun aFileThatWentAwayOnTheComputer() {
        for (st in listOf(NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, NtStatus.STATUS_OBJECT_PATH_NOT_FOUND, NtStatus.STATUS_NO_SUCH_FILE,
            NtStatus.STATUS_DELETE_PENDING, NtStatus.STATUS_FILE_DELETED)) {
            assertTrue(st.name, NetErrors.isGone(api(st, SMB2MessageCommandCode.SMB2_CREATE)))
        }
        assertFalse(NetErrors.isGone(api(NtStatus.STATUS_SHARING_VIOLATION, SMB2MessageCommandCode.SMB2_CREATE)))
        assertFalse(NetErrors.isGone(TransportException("closed")))
        // impacket and some NAS say "no such file" where Windows says "not found".
        assertTrue(NetErrors.isNotFound(api(NtStatus.STATUS_NO_SUCH_FILE, SMB2MessageCommandCode.SMB2_CREATE)))
        assertEquals(NetReason.NO_FOLDER, NetErrors.reason(api(NtStatus.STATUS_NO_SUCH_FILE, SMB2MessageCommandCode.SMB2_CREATE), NetStage.FOLDER))
    }

    @Test fun unknownSizeIsNotFull() {
        assertFalse(NetShare.isShareFull(0L, 0L)) // the server didn't say
        assertFalse(NetShare.isShareFull(5L shl 30, 100L shl 30))
        assertTrue(NetShare.isShareFull(0L, 100L shl 30))
        assertTrue(NetShare.isShareFull((1L shl 30) - 1, 100L shl 30))
        assertFalse(NetShare.isShareFull(-1L, 100L shl 30))
    }

    @Test fun smallQuestions() {
        assertTrue(NetErrors.isNotFound(api(NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, SMB2MessageCommandCode.SMB2_CREATE)))
        assertTrue(NetErrors.isNameTaken(api(NtStatus.STATUS_OBJECT_NAME_COLLISION, SMB2MessageCommandCode.SMB2_CREATE)))
        assertTrue(NetErrors.isDiskFull(SMBRuntimeException(api(NtStatus.STATUS_DISK_FULL, SMB2MessageCommandCode.SMB2_WRITE))))
        assertFalse(NetErrors.isNotFound(RuntimeException()))
    }
}
