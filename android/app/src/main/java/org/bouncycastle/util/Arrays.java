package org.bouncycastle.util;

/**
 * Stand-in for the one BouncyCastle method smbj calls outside its own
 * BouncyCastle provider: com.hierynomus.ntlm.functions.NtlmV2Functions uses
 * org.bouncycastle.util.Arrays.copyOfRange while computing the NTLMv2
 * response, on every sign-in to a computer.
 *
 * The app leaves BouncyCastle out (about 8 MB; see the smbj dependency in
 * app/build.gradle and com.snowmedia.dvr.SmbSecurity), so without this class
 * every sign-in would fail with NoClassDefFoundError. Same signature and
 * behaviour as BouncyCastle's (java.util.Arrays.copyOfRange). If BouncyCastle
 * is ever added back, delete this file: the build then fails on the duplicate
 * class, which is the reminder.
 */
public final class Arrays {
    private Arrays() {}

    public static byte[] copyOfRange(byte[] original, int from, int to) {
        return java.util.Arrays.copyOfRange(original, from, to);
    }
}
