package com.snowmedia.dvr

import com.hierynomus.ntlm.functions.NtlmV2Functions
import com.hierynomus.ntlm.messages.NtlmChallenge
import com.hierynomus.protocol.commons.buffer.Buffer
import com.hierynomus.protocol.commons.buffer.Endian
import com.hierynomus.security.Cipher
import com.hierynomus.security.SecurityException
import com.hierynomus.security.jce.derivationfunction.CounterDerivationParameters
import com.hierynomus.smbj.SMBClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.Random

/**
 * SmbSecurity against the official test vectors: MD4 (RFC 1320), the NTLM
 * hashes of MS-NLMP 4.2, AES-CMAC (RFC 4493), the SMB 3.0 and 3.1.1 key
 * derivations and a real SMB 3.1.1 signature (Microsoft's "SMB 2 and SMB 3
 * security in Windows 10: the anatomy of signing and cryptographic keys",
 * appendix), and RC4 (RFC 6229). BouncyCastle is not on this classpath
 * either (excluded in build.gradle), so smbj's NTLM code is checked to run
 * without it.
 */
class SmbSecurityTest {
    private val sec = SmbSecurity()

    private fun hex(s: String): ByteArray {
        val c = s.replace(" ", "").replace("\n", "")
        return ByteArray(c.length / 2) { i -> c.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    private fun md4(s: String): ByteArray = sec.getDigest("MD4").run { update(s.toByteArray(Charsets.US_ASCII)); digest() }

    @Test fun md4Rfc1320() {
        assertArrayEquals(hex("31d6cfe0d16ae931b73c59d7e0c089c0"), md4(""))
        assertArrayEquals(hex("bde52cb31de33e46245e05fbdbd6fb24"), md4("a"))
        assertArrayEquals(hex("a448017aaf21d8525fc10ae87aa6729d"), md4("abc"))
        assertArrayEquals(hex("d9130a8164549fe818874806e1c7014b"), md4("message digest"))
        assertArrayEquals(hex("d79e1c308aa5bbcdeea8ed63df412da9"), md4("abcdefghijklmnopqrstuvwxyz"))
        assertArrayEquals(hex("043f8582f241db351ce627e153e7f0e4"), md4("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"))
        assertArrayEquals(
            hex("e33b4ddc9c38f2199c3e7b164fcc0536"),
            md4("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
        )
    }

    @Test fun md4ResetsAfterDigestAndTakesSlices() {
        val d = sec.getDigest("MD4")
        d.update("xxabcxx".toByteArray(), 2, 3)
        assertArrayEquals(hex("a448017aaf21d8525fc10ae87aa6729d"), d.digest())
        d.update("abc".toByteArray())
        assertArrayEquals(hex("a448017aaf21d8525fc10ae87aa6729d"), d.digest())
        assertEquals(16, d.digestLength)
    }

    /** MS-NLMP 4.2.1: NTOWFv1("Password"), the NT hash. */
    @Test fun ntHashOfPassword() {
        val d = sec.getDigest("MD4")
        d.update("Password".toByteArray(Charsets.UTF_16LE))
        assertArrayEquals(hex("a4f49c406510bdcab6824ee7c30fd852"), d.digest())
    }

    /** MS-NLMP 4.2.4.1.1: NTOWFv2 for User / Domain / Password, through smbj's own NTLM code. */
    @Test fun ntowfV2ThroughSmbj() {
        val f = NtlmV2Functions(Random(), sec)
        assertArrayEquals(hex("0c868a403bfd7a93a3001ef22ef02e3f"), f.NTOWFv2("Password", "User", "Domain"))
    }

    /**
     * MS-NLMP 4.2.4: the whole NTLMv2 response from the example CHALLENGE_MESSAGE.
     * computeResponse is where smbj calls org.bouncycastle.util.Arrays, so this also
     * proves the stand-in class works with BouncyCastle absent.
     */
    @Test fun ntlmV2ResponseFromTheSpecExample() {
        val challengeBytes = hex(
            "4e544c4d53535000020000000c000c003800000033828ae20123456789abcdef" +
                "00000000000000002400240044000000060070170000000f5300650072007600" +
                "6500720002000c0044006f006d00610069006e0001000c005300650072007600" +
                "6500720000000000",
        )
        val challenge = NtlmChallenge()
        challenge.read(Buffer.PlainBuffer(challengeBytes, Endian.LE))
        assertArrayEquals(hex("0123456789abcdef"), challenge.serverChallenge)
        val clientChallengeAa = object : Random() {
            override fun nextBytes(bytes: ByteArray) { bytes.fill(0xaa.toByte()) }
        }
        val r = NtlmV2Functions(clientChallengeAa, sec)
            .computeResponse("User", "Domain", "Password".toCharArray(), challenge, 0L, challenge.targetInfo)
        assertArrayEquals(hex("68cd0ab851e51c96aabc927bebef6a1c"), r.ntResponse.copyOfRange(0, 16))
        assertArrayEquals(hex("8de40ccadbc14a82f15cb0ad0de95ca3"), r.sessionBaseKey)
        // LMv2: HMAC_MD5(ResponseKeyLM, ServerChallenge || ClientChallenge) || ClientChallenge.
        assertArrayEquals(hex("86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa"), r.lmResponse)
    }

    @Test fun bouncyCastleIsNotOnTheClasspath() {
        try {
            Class.forName("org.bouncycastle.crypto.digests.MD4Digest")
            fail("BouncyCastle should be excluded")
        } catch (_: ClassNotFoundException) { /* as intended */ }
        // The stand-in is the only org.bouncycastle class there is.
        assertArrayEquals(byteArrayOf(2, 3), org.bouncycastle.util.Arrays.copyOfRange(byteArrayOf(1, 2, 3, 4), 1, 3))
    }

    // ---- AES-CMAC, RFC 4493 section 4 ----

    private val cmacKey = hex("2b7e151628aed2a6abf7158809cf4f3c")
    private val cmacMsg = hex(
        "6bc1bee22e409f96e93d7e117393172a ae2d8a571e03ac9c9eb76fac45af8e51" +
            "30c81c46a35ce411e5fbc1191a0a52ef f69f2445df4f9b17ad2b417be66c3710",
    )

    private fun cmac(key: ByteArray, msg: ByteArray, step: Int = msg.size.coerceAtLeast(1)): ByteArray {
        val m = sec.getMac("AesCmac")
        m.init(key)
        var i = 0
        while (i < msg.size) { val n = minOf(step, msg.size - i); m.update(msg, i, n); i += n }
        return m.doFinal()
    }

    @Test fun aesCmacRfc4493() {
        assertArrayEquals(hex("bb1d6929e95937287fa37d129b756746"), cmac(cmacKey, ByteArray(0)))
        assertArrayEquals(hex("070a16b46b4d4144f79bdd9dd04a287c"), cmac(cmacKey, cmacMsg.copyOf(16)))
        assertArrayEquals(hex("dfa66747de9ae63030ca32611497c827"), cmac(cmacKey, cmacMsg.copyOf(40)))
        assertArrayEquals(hex("51f0bebf7e3b9d92fc49741779363cfe"), cmac(cmacKey, cmacMsg))
    }

    @Test fun aesCmacGivesTheSameTagHoweverTheDataArrives() {
        for (len in listOf(0, 1, 15, 16, 17, 31, 32, 33, 40, 64)) {
            val msg = cmacMsg.copyOf(minOf(len, 64)).let { if (len > 64) it + ByteArray(len - 64) else it }
            val whole = cmac(cmacKey, msg)
            for (step in listOf(1, 3, 16, 17)) assertArrayEquals("len $len step $step", whole, cmac(cmacKey, msg, step))
        }
        // Byte by byte through update(Byte), and the Mac is reusable after doFinal.
        val m = sec.getMac("AesCmac")
        m.init(cmacKey)
        cmacMsg.copyOf(40).forEach { m.update(it) }
        assertArrayEquals(hex("dfa66747de9ae63030ca32611497c827"), m.doFinal())
        m.update(cmacMsg, 0, 16)
        assertArrayEquals(hex("070a16b46b4d4144f79bdd9dd04a287c"), m.doFinal())
    }

    @Test fun aesCmacOverAMegabyteMatchesSmallSteps() {
        val big = ByteArray((1 shl 20) + 7) { (it * 31 + 7).toByte() }
        assertArrayEquals(cmac(cmacKey, big, 4093), cmac(cmacKey, big))
    }

    // ---- SMB 3 key derivation (SP800-108 counter mode, HMAC-SHA256) ----

    private fun z(s: String) = s.toByteArray(Charsets.US_ASCII) + 0

    private fun kdf(key: ByteArray, label: ByteArray, context: ByteArray): ByteArray {
        val suffix = ByteArrayOutputStream()
        suffix.write(label); suffix.write(0); suffix.write(context); suffix.write(byteArrayOf(0, 0, 0, 0x80.toByte()))
        val f = sec.getDerivationFunction("KDF/Counter/HMACSHA256")
        f.init(CounterDerivationParameters(key, suffix.toByteArray(), 32))
        val out = ByteArray(16)
        f.generateBytes(out, 0, 16)
        return out
    }

    @Test fun smb30KeyDerivation() {
        val session = hex("7CD451825D0450D235424E44BA6E78CC")
        assertArrayEquals(hex("0B7E9C5CAC36C0F6EA9AB275298CEDCE"), kdf(session, z("SMB2AESCMAC"), z("SmbSign")))
        assertArrayEquals(hex("FAD27796665B313EBB578F388632B4F7"), kdf(session, z("SMB2AESCCM"), z("ServerIn ")))
        assertArrayEquals(hex("B0F0427F7CEB416D1D9DCC0CD4F99447"), kdf(session, z("SMB2AESCCM"), z("ServerOut")))
        assertArrayEquals(hex("BB23A4575AA26C721AF525AF15A87B4F"), kdf(session, z("SMB2APP"), z("SmbRpc")))
        // The second channel's signing key.
        assertArrayEquals(hex("BA1A17DBBFEC349BCA105563D598952F"), kdf(hex("4E01A2B313BCF660CC250BEF021AEDE6"), z("SMB2AESCMAC"), z("SmbSign")))
    }

    private val preauth311 = hex(
        "0DD13628CC3ED218EF9DF9772D436D0887AB9814BFAE63A80AA845F36909DB7928622DDDAD522D97" +
            "51640A459762C5A9D6BB084CBB3CE6BDADEF5D5BCE3C6C01",
    )

    @Test fun smb311KeyDerivation() {
        val session = hex("270E1BA896585EEB7AF3472D3B4C75A7")
        assertArrayEquals(hex("73FE7A9A77BEF0BDE49C650D8CCB5F76"), kdf(session, z("SMBSigningKey"), preauth311))
        assertArrayEquals(hex("629BCBC54422A0F572B97F45989B6073"), kdf(session, z("SMBC2SCipherKey"), preauth311))
        assertArrayEquals(hex("E2AF0DCEFAC68DA71A0DFBD0D1350D74"), kdf(session, z("SMBS2CCipherKey"), preauth311))
        assertArrayEquals(hex("6D7AD7954E9EC61E907B4D473DC178FF"), kdf(session, z("SMBAppKey"), preauth311))
    }

    /** The final SESSION_SETUP response of the 3.1.1 example, signed with the derived key: AES-CMAC over it with the signature zeroed. */
    @Test fun smb311SessionSetupResponseSignature() {
        val packet = hex(
            "FE534D4240000100000000000100800009000000000000000300000000000000FFFE000000000000" +
                "1900000000100000EBE146DA120BA25FC3376A49DFE31BC10900000048001D00A11B3019A0030A01" +
                "00A3120410010000003B453CDC3524164200000000",
        )
        val signature = packet.copyOfRange(48, 64)
        assertArrayEquals(hex("EBE146DA120BA25FC3376A49DFE31BC1"), signature)
        val zeroed = packet.copyOf().also { for (i in 48 until 64) it[i] = 0 }
        assertArrayEquals(signature, cmac(hex("73FE7A9A77BEF0BDE49C650D8CCB5F76"), zeroed))
    }

    @Test fun kdfLongerThanOneBlock() {
        // Two rounds: K(1) || K(2), so the counter goes up.
        val f = sec.getDerivationFunction("KDF/Counter/HMACSHA256")
        f.init(CounterDerivationParameters(ByteArray(16) { 1 }, byteArrayOf(9, 9), 32))
        val out = ByteArray(40)
        f.generateBytes(out, 0, 40)
        val mac = javax.crypto.Mac.getInstance("HmacSHA256").apply { init(javax.crypto.spec.SecretKeySpec(ByteArray(16) { 1 }, "HmacSHA256")) }
        val k1 = mac.doFinal(byteArrayOf(0, 0, 0, 1, 9, 9))
        val k2 = mac.doFinal(byteArrayOf(0, 0, 0, 2, 9, 9))
        assertArrayEquals(k1 + k2.copyOf(8), out)
    }

    // ---- RC4 ----

    private fun rc4(key: ByteArray, data: ByteArray): ByteArray {
        val c = sec.getCipher("RC4")
        c.init(Cipher.CryptMode.ENCRYPT, key)
        val out = ByteArray(data.size)
        c.update(data, 0, data.size, out, 0)
        c.doFinal(out, data.size)
        return out
    }

    @Test fun rc4Rfc6229FortyBitKey() {
        val ks = rc4(hex("0102030405"), ByteArray(32))
        assertArrayEquals(hex("b2396305f03dc027ccc3524a0a1118a8 6982944f18fc82d589c403a47a0d0919"), ks)
    }

    @Test fun rc4MatchesTheJvmArcfour() {
        val key = ByteArray(16) { (it * 13 + 5).toByte() }
        val data = ByteArray(1000) { (it * 7).toByte() }
        val jvm = javax.crypto.Cipher.getInstance("ARCFOUR").run {
            init(javax.crypto.Cipher.ENCRYPT_MODE, javax.crypto.spec.SecretKeySpec(key, "ARCFOUR"))
            doFinal(data)
        }
        assertArrayEquals(jvm, rc4(key, data))
    }

    @Test fun encryptionIsRefusedAndUnknownKdfToo() {
        try { sec.getAEADBlockCipher("AES/CCM/NoPadding"); fail() } catch (_: SecurityException) { /* not offered */ }
        try { sec.getDerivationFunction("KDF/Feedback"); fail() } catch (_: SecurityException) { /* unknown */ }
    }

    /** The real client configuration builds and a client opens without BouncyCastle (no network used). */
    @Test fun smbClientConfigBuildsWithoutBouncyCastle() {
        val config = NetShare.config()
        assertNotNull(config.securityProvider as? SmbSecurity)
        assertEquals(false, config.isEncryptData)
        assertEquals(true, config.isSigningEnabled)
        assertEquals(NetShare.IO_TIMEOUT_S * 1000L, config.readTimeout)
        SMBClient(config).close()
    }
}
