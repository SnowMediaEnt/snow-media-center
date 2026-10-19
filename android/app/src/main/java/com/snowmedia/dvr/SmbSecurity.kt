package com.snowmedia.dvr

import com.hierynomus.security.AEADBlockCipher
import com.hierynomus.security.Cipher
import com.hierynomus.security.DerivationFunction
import com.hierynomus.security.Mac
import com.hierynomus.security.MessageDigest
import com.hierynomus.security.SecurityException
import com.hierynomus.security.SecurityProvider
import com.hierynomus.security.jce.JceSecurityProvider
import com.hierynomus.security.jce.derivationfunction.CounterDerivationParameters
import com.hierynomus.security.jce.derivationfunction.DerivationParameters
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The cryptography smbj asks for, without BouncyCastle (which would add
 * about 8 MB to the APK). Android's own providers (Conscrypt) already do
 * MD5, SHA-256/512, HMAC-SHA256, AES and DES; what they lack, or only have
 * on some Android versions, is done here:
 *  - MD4 (RFC 1320): the NT password hash in NTLM sign-in;
 *  - AES-128-CMAC (RFC 4493): message signing in SMB 3 (Windows 11 signs
 *    every message);
 *  - the SP800-108 counter-mode KDF with HMAC-SHA256: how SMB 3 derives its
 *    signing key from the session key;
 *  - RC4: NTLM's key exchange (Conscrypt names it ARC4, and not on every
 *    version), done here so it never depends on the box.
 * Each is checked against its official test vectors (SmbSecurityTest).
 *
 * Encryption (AES-CCM / AES-GCM) is NOT offered: NetShare never asks for it
 * (withEncryptData(false)), so smbj never negotiates it. A computer that
 * demands encryption refuses the sign-in or the share with "access denied",
 * which NetShare reports as an error. Android has AES-GCM but not AES-CCM,
 * which SMB 3.0 servers require, hence the refusal below rather than half
 * support.
 */
internal class SmbSecurity : SecurityProvider {
    private val jce = JceSecurityProvider()

    override fun getDigest(name: String): MessageDigest =
        if (name.equals("MD4", ignoreCase = true)) Md4() else jce.getDigest(name)

    override fun getMac(name: String): Mac = when {
        name.equals("AesCmac", ignoreCase = true) || name.equals("AES-CMAC", ignoreCase = true) -> AesCmac()
        else -> jce.getMac(name) // HmacSHA256 (SMB 2 signing), HMACT64 (NTLM's HMAC-MD5)
    }

    override fun getCipher(name: String): Cipher =
        if (name.equals("RC4", ignoreCase = true) || name.equals("ARC4", ignoreCase = true)) Rc4() else jce.getCipher(name)

    override fun getAEADBlockCipher(name: String): AEADBlockCipher =
        throw SecurityException("SMB encryption is not supported by this app")

    override fun getDerivationFunction(name: String): DerivationFunction {
        if (!name.equals("KDF/Counter/HMACSHA256", ignoreCase = true)) throw SecurityException("Unknown derivation function")
        return CounterKdf()
    }

    /** MD4, RFC 1320. Only ever used for the NT hash of a password (short input), so plain and small. */
    class Md4 : MessageDigest {
        private val state = IntArray(4)
        private val block = ByteArray(64)
        private var blockLen = 0
        private var total = 0L
        private val x = IntArray(16)

        init { reset() }

        override fun reset() {
            state[0] = 0x67452301; state[1] = -0x10325477; state[2] = -0x67452302; state[3] = 0x10325476
            blockLen = 0
            total = 0L
        }

        override fun getDigestLength(): Int = 16

        override fun update(b: Byte) {
            block[blockLen++] = b
            total++
            if (blockLen == 64) { process(block, 0); blockLen = 0 }
        }

        override fun update(bytes: ByteArray) = update(bytes, 0, bytes.size)

        override fun update(bytes: ByteArray, offset: Int, len: Int) {
            for (i in offset until offset + len) update(bytes[i])
        }

        override fun digest(): ByteArray {
            val bits = total * 8
            update(0x80.toByte())
            while (blockLen != 56) update(0.toByte())
            for (i in 0 until 8) update((bits ushr (8 * i)).toByte())
            val out = ByteArray(16)
            for (i in 0 until 4) for (j in 0 until 4) out[i * 4 + j] = (state[i] ushr (8 * j)).toByte()
            reset()
            return out
        }

        private fun process(b: ByteArray, off: Int) {
            for (i in 0 until 16) {
                val p = off + i * 4
                x[i] = (b[p].toInt() and 0xFF) or ((b[p + 1].toInt() and 0xFF) shl 8) or
                    ((b[p + 2].toInt() and 0xFF) shl 16) or ((b[p + 3].toInt() and 0xFF) shl 24)
            }
            var a = state[0]; var bb = state[1]; var c = state[2]; var d = state[3]
            // Round 1: F(x,y,z) = (x and y) or (not x and z)
            for (i in intArrayOf(0, 4, 8, 12)) {
                a = Integer.rotateLeft(a + ((bb and c) or (bb.inv() and d)) + x[i], 3)
                d = Integer.rotateLeft(d + ((a and bb) or (a.inv() and c)) + x[i + 1], 7)
                c = Integer.rotateLeft(c + ((d and a) or (d.inv() and bb)) + x[i + 2], 11)
                bb = Integer.rotateLeft(bb + ((c and d) or (c.inv() and a)) + x[i + 3], 19)
            }
            // Round 2: G(x,y,z) = majority, + 0x5A827999
            for (i in 0 until 4) {
                a = Integer.rotateLeft(a + ((bb and c) or (bb and d) or (c and d)) + x[i] + 0x5A827999, 3)
                d = Integer.rotateLeft(d + ((a and bb) or (a and c) or (bb and c)) + x[i + 4] + 0x5A827999, 5)
                c = Integer.rotateLeft(c + ((d and a) or (d and bb) or (a and bb)) + x[i + 8] + 0x5A827999, 9)
                bb = Integer.rotateLeft(bb + ((c and d) or (c and a) or (d and a)) + x[i + 12] + 0x5A827999, 13)
            }
            // Round 3: H(x,y,z) = x xor y xor z, + 0x6ED9EBA1
            for (i in intArrayOf(0, 2, 1, 3)) {
                a = Integer.rotateLeft(a + (bb xor c xor d) + x[i] + 0x6ED9EBA1, 3)
                d = Integer.rotateLeft(d + (a xor bb xor c) + x[i + 8] + 0x6ED9EBA1, 9)
                c = Integer.rotateLeft(c + (d xor a xor bb) + x[i + 4] + 0x6ED9EBA1, 11)
                bb = Integer.rotateLeft(bb + (c xor d xor a) + x[i + 12] + 0x6ED9EBA1, 15)
            }
            state[0] += a; state[1] += bb; state[2] += c; state[3] += d
        }
    }

    /**
     * AES-CMAC, RFC 4493. Every SMB 3 message is signed with it, and a write
     * carries up to a megabyte, so the blocks go through the platform's
     * AES-CBC in bulk (CBC with a zero IV is CMAC's chain); only the last
     * block, which CMAC treats specially, is held back until [doFinal].
     */
    class AesCmac : Mac {
        private var cbc: javax.crypto.Cipher? = null
        private var key: SecretKeySpec? = null
        private val k1 = ByteArray(16)
        private val k2 = ByteArray(16)
        /** The last block seen so far (1..16 bytes once anything came): not chained until more data proves it isn't the last. */
        private val held = ByteArray(16)
        private var heldLen = 0
        private val scratch = ByteArray(BULK)

        override fun init(key: ByteArray) {
            if (key.size != 16 && key.size != 24 && key.size != 32) throw SecurityException("AES-CMAC needs a 128, 192 or 256-bit key")
            try {
                val k = SecretKeySpec(key, "AES")
                this.key = k
                val ecb = javax.crypto.Cipher.getInstance("AES/ECB/NoPadding")
                ecb.init(javax.crypto.Cipher.ENCRYPT_MODE, k)
                val l = ecb.doFinal(ByteArray(16))
                shiftXor(l, k1)
                shiftXor(k1, k2)
                cbc = javax.crypto.Cipher.getInstance("AES/CBC/NoPadding")
                reset()
            } catch (e: SecurityException) {
                throw e
            } catch (e: Exception) {
                throw SecurityException(e)
            }
        }

        override fun update(b: Byte) = update(byteArrayOf(b), 0, 1)

        override fun update(array: ByteArray) = update(array, 0, array.size)

        override fun update(array: ByteArray, offset: Int, length: Int) {
            val c = cbc ?: throw IllegalStateException("AES-CMAC not initialised")
            var o = offset
            var n = length
            if (n <= 0) return
            // Fill the held block first.
            val take = minOf(16 - heldLen, n)
            System.arraycopy(array, o, held, heldLen, take)
            heldLen += take; o += take; n -= take
            if (n == 0) return
            // More is coming, so the held block was not the last: chain it.
            c.update(held, 0, 16, scratch, 0)
            heldLen = 0
            // Whole blocks in bulk, always keeping 1..16 bytes back as the possible last block.
            var bulk = ((n - 1) / 16) * 16
            while (bulk > 0) {
                val step = minOf(bulk, BULK)
                c.update(array, o, step, scratch, 0)
                o += step; n -= step; bulk -= step
            }
            System.arraycopy(array, o, held, 0, n)
            heldLen = n
        }

        override fun doFinal(): ByteArray {
            val c = cbc ?: throw IllegalStateException("AES-CMAC not initialised")
            val last = ByteArray(16)
            if (heldLen == 16) {
                for (i in 0 until 16) last[i] = (held[i].toInt() xor k1[i].toInt()).toByte()
            } else {
                System.arraycopy(held, 0, last, 0, heldLen)
                last[heldLen] = 0x80.toByte()
                for (i in 0 until 16) last[i] = (last[i].toInt() xor k2[i].toInt()).toByte()
            }
            val tag = c.doFinal(last)
            reset()
            return tag
        }

        override fun reset() {
            heldLen = 0
            val c = cbc ?: return
            // A fresh chain from a zero IV (re-initialised rather than trusting doFinal's own reset on every provider).
            c.init(javax.crypto.Cipher.ENCRYPT_MODE, key, IvParameterSpec(ByteArray(16)))
        }

        private companion object {
            const val BULK = 64 * 1024

            /** out = (in << 1) xor (0x87 if in's top bit was set): RFC 4493 subkey generation. */
            fun shiftXor(input: ByteArray, out: ByteArray) {
                var carry = 0
                for (i in 15 downTo 0) {
                    val v = input[i].toInt() and 0xFF
                    out[i] = ((v shl 1) or carry).toByte()
                    carry = v ushr 7
                }
                if ((input[0].toInt() and 0x80) != 0) out[15] = (out[15].toInt() xor 0x87).toByte()
            }
        }
    }

    /** RC4, for NTLM's key exchange (one 16-byte key, encrypted once per sign-in). */
    class Rc4 : Cipher {
        private val s = IntArray(256)
        private var i = 0
        private var j = 0

        override fun init(cryptMode: Cipher.CryptMode, bytes: ByteArray) {
            if (bytes.isEmpty() || bytes.size > 256) throw SecurityException("RC4 key must be 1 to 256 bytes")
            for (k in 0 until 256) s[k] = k
            var jj = 0
            for (k in 0 until 256) {
                jj = (jj + s[k] + (bytes[k % bytes.size].toInt() and 0xFF)) and 0xFF
                val t = s[k]; s[k] = s[jj]; s[jj] = t
            }
            i = 0; j = 0
        }

        override fun update(input: ByteArray, inOff: Int, bytes: Int, out: ByteArray, outOff: Int): Int {
            for (k in 0 until bytes) {
                i = (i + 1) and 0xFF
                j = (j + s[i]) and 0xFF
                val t = s[i]; s[i] = s[j]; s[j] = t
                out[outOff + k] = (input[inOff + k].toInt() xor s[(s[i] + s[j]) and 0xFF]).toByte()
            }
            return bytes
        }

        override fun doFinal(out: ByteArray, outOff: Int): Int = 0

        override fun reset() { i = 0; j = 0 }
    }

    /**
     * SP800-108 KDF in counter mode, HMAC-SHA256 as the PRF:
     * K(i) = HMAC(Ki, [i]_r || FixedSuffix), i from 1. smbj builds the fixed
     * suffix (Label || 0x00 || Context || [L]_32) and asks for 16 bytes.
     */
    class CounterKdf : DerivationFunction {
        private var mac: javax.crypto.Mac? = null
        private var suffix = ByteArray(0)
        private var counterBytes = 4

        override fun init(parameters: DerivationParameters) {
            val p = parameters as? CounterDerivationParameters ?: throw SecurityException("Counter-mode parameters required")
            val r = p.counterLength
            if (r <= 0 || r > 32 || r % 8 != 0) throw SecurityException("Unsupported counter length")
            counterBytes = r / 8
            suffix = p.fixedCounterSuffix ?: ByteArray(0)
            try {
                mac = javax.crypto.Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(p.seed, "HmacSHA256")) }
            } catch (e: Exception) {
                throw SecurityException(e)
            }
        }

        override fun generateBytes(out: ByteArray, outOff: Int, len: Int): Int {
            val m = mac ?: throw IllegalStateException("KDF not initialised")
            var done = 0
            var counter = 1L
            while (done < len) {
                for (b in counterBytes - 1 downTo 0) m.update((counter ushr (8 * b)).toByte())
                m.update(suffix)
                val k = m.doFinal()
                val n = minOf(k.size, len - done)
                System.arraycopy(k, 0, out, outOff + done, n)
                done += n
                counter++
            }
            return len
        }
    }
}
