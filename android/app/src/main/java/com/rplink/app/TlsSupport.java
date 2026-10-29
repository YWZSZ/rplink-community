package com.rplink.app;

import android.net.http.SslCertificate;
import android.os.Bundle;
import android.util.Base64;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** TLS pinning and HTTP helpers shared by pairing, health and downloads. */
public final class TlsSupport {
    private TlsSupport() {
    }

    public static X509Certificate parseCertificate(String pem) throws Exception {
        CertificateFactory factory = CertificateFactory.getInstance("X.509");
        return (X509Certificate) factory.generateCertificate(
                new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
    }

    public static String fingerprint(X509Certificate certificate) throws Exception {
        return sha256Hex(certificate.getEncoded());
    }

    public static String sha256Hex(byte[] bytes) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder builder = new StringBuilder(digest.length * 2);
        for (byte value : digest) builder.append(String.format("%02x", value & 0xff));
        return builder.toString();
    }

    public static SSLContext pinnedContext(X509Certificate ca) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KeyStore.getDefaultType());
        keyStore.load(null, null);
        keyStore.setCertificateEntry("dsh-link-ca", ca);
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(keyStore);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, factory.getTrustManagers(), new SecureRandom());
        return context;
    }

    public static SSLContext insecureContext() throws Exception {
        TrustManager[] managers = new TrustManager[]{new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }};
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, managers, new SecureRandom());
        return context;
    }

    public static String fetchCaPem(String host, int port, int timeoutMs) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(
                "https://" + host + ":" + port + "/ca").openConnection();
        connection.setSSLSocketFactory(insecureContext().getSocketFactory());
        connection.setHostnameVerifier((hostname, session) -> true);
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Accept", "application/x-pem-file, text/plain");
        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = readAll(stream);
            if (status != 200) throw new IllegalStateException("获取电脑证书失败（HTTP " + status + "）");
            return body;
        } finally {
            connection.disconnect();
        }
    }

    public static HttpsURLConnection open(String host, int port, String caPem, String path, String token, int timeoutMs) throws Exception {
        X509Certificate ca = parseCertificate(caPem);
        HttpsURLConnection connection = (HttpsURLConnection) new URL("https://" + host + ":" + port + path).openConnection();
        connection.setSSLSocketFactory(pinnedContext(ca).getSocketFactory());
        connection.setConnectTimeout(timeoutMs);
        connection.setReadTimeout(timeoutMs);
        connection.setRequestProperty("Accept", "application/json, text/plain, */*");
        connection.setRequestProperty("Cache-Control", "no-store");
        if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        return connection;
    }

    public static String health(String host, int port, String caPem, String token, int timeoutMs) throws Exception {
        HttpsURLConnection connection = open(host, port, caPem, "/health", token, timeoutMs);
        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = readAll(stream);
            if (status != 200) throw new IllegalStateException("HTTP " + status + (body.isEmpty() ? "" : ": " + body));
            return body;
        } finally {
            connection.disconnect();
        }
    }

    public static org.json.JSONObject bootstrap(ServerRecord server) throws Exception {
        HttpsURLConnection connection = open(server.host, server.port, server.caPem, "/api/bootstrap", server.token, 8000);
        connection.setRequestProperty("x-rp-token", server.token);
        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = readAll(stream);
            if (status != 200) throw new IllegalStateException("HTTP " + status + (body.isEmpty() ? "" : ": " + body));
            return new org.json.JSONObject(body);
        } finally {
            connection.disconnect();
        }
    }

    public static String readAll(InputStream input) throws Exception {
        if (input == null) return "";
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        return output.toString(StandardCharsets.UTF_8.name());
    }

    /** Best-effort extraction of the DER leaf certificate from an SslError. */
    public static byte[] sslCertificateDer(SslCertificate certificate) {
        if (certificate == null) return null;
        Bundle state = SslCertificate.saveState(certificate);
        if (state == null) return null;
        return state.getByteArray("x509-certificate");
    }

    public static String base64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }
}
