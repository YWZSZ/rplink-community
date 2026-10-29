package com.rplink.app;

import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

/** Pairing handshake with certificate-fingerprint pinning. */
public final class PairingClient {
    public interface Callback {
        void onSuccess(ServerRecord server);

        void onError(String message, Throwable error);
    }

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private PairingClient() {
    }

    public static void pair(Context context, PairingLink link, Callback callback) {
        EXECUTOR.execute(() -> {
            try {
                ServerRecord server = perform(context, link);
                MAIN.post(() -> callback.onSuccess(server));
            } catch (Exception error) {
                MAIN.post(() -> callback.onError(friendly(error), error));
            }
        });
    }

    private static ServerRecord perform(Context context, PairingLink link) throws Exception {
        if (link == null) throw new IllegalArgumentException("配对链接格式不正确");
        String caPem = TlsSupport.fetchCaPem(link.host, link.port, 12000);
        X509Certificate ca = TlsSupport.parseCertificate(caPem);
        String actual = TlsSupport.fingerprint(ca);
        if (link.fingerprint == null || !actual.equalsIgnoreCase(link.fingerprint.trim())) {
            throw new SecurityException("电脑证书指纹与二维码不一致，已停止配对");
        }

        HttpsURLConnection connection = TlsSupport.open(link.host, link.port, caPem, "/api/pair", null, 15000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setRequestProperty("Accept", "application/json");
        JSONObject body = new JSONObject();
        body.put("code", link.code);
        body.put("deviceName", Build.MANUFACTURER + " " + Build.MODEL);
        try {
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = TlsSupport.readAll(stream);
            if (status != 200) throw new IllegalStateException("配对被拒绝（HTTP " + status + "）" + (text.isEmpty() ? "" : "：" + text));
            JSONObject response = new JSONObject(text);
            if (!response.optBoolean("ok", false)) throw new IllegalStateException(response.optString("error", "配对失败"));
            String token = response.getString("token");
            JSONObject server = response.optJSONObject("server");
            String name = server == null ? link.name : server.optString("name", link.name);
            String serverId = link.serverId == null || link.serverId.isEmpty() ? "rplink" : link.serverId;
            return new ServerRecord(serverId, name, link.host, link.port, caPem, token, System.currentTimeMillis());
        } finally {
            connection.disconnect();
        }
    }

    private static String friendly(Exception error) {
        if (error == null) return "配对失败";
        String message = error.getMessage();
        if (message == null || message.isEmpty()) return error.getClass().getSimpleName();
        if (message.contains("CLEARTEXT")) return "电脑端地址必须是 HTTPS";
        if (message.contains("Failed to connect") || message.contains("Connection refused") || message.contains("timeout")) {
            return "连接不上电脑。请确认手机和电脑在同一个 Wi-Fi，且电脑端已开启「手机连接」。";
        }
        if (message.contains("certificate") || message.contains("CertPathValidator") || message.contains("Trust anchor")) {
            return "HTTPS 证书验证失败，请重新生成二维码配对。";
        }
        return message;
    }
}
