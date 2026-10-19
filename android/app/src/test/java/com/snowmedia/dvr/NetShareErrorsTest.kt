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

    @Test fun smallQuestions() {
        assertTrue(NetErrors.isNotFound(api(NtStatus.STATUS_OBJECT_NAME_NOT_FOUND, SMB2MessageCommandCode.SMB2_CREATE)))
        assertTrue(NetErrors.isNameTaken(api(NtStatus.STATUS_OBJECT_NAME_COLLISION, SMB2MessageCommandCode.SMB2_CREATE)))
        assertTrue(NetErrors.isDiskFull(SMBRuntimeException(api(NtStatus.STATUS_DISK_FULL, SMB2MessageCommandCode.SMB2_WRITE))))
        assertFalse(NetErrors.isNotFound(RuntimeException()))
    }
}
