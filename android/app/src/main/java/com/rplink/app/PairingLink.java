package com.rplink.app;

import android.net.Uri;

import org.json.JSONException;
import org.json.JSONObject;

/** Parsed rplink://pair or JSON QR payload. */
public final class PairingLink {
    public final String host;
    public final int port;
    public final String serverId;
    public final String fingerprint;
    public final String code;
    public final String name;

    public PairingLink(String host, int port, String serverId, String fingerprint, String code, String name) {
        this.host = host;
        this.port = port;
        this.serverId = serverId;
        this.fingerprint = fingerprint;
        this.code = code;
        this.name = name;
    }

    public static PairingLink parse(String raw) {
        if (raw == null) return null;
        String value = raw.trim();
        if (value.isEmpty()) return null;
        try {
            if (value.startsWith("{")) {
                JSONObject object = new JSONObject(value);
                return new PairingLink(
                        object.getString("host"),
                        object.getInt("port"),
                        object.optString("sid", object.optString("serverId", "")),
                        object.getString("fp"),
                        object.getString("code"),
                        object.optString("name", "DSH")
                );
            }
            Uri uri = Uri.parse(value);
            if (!"rplink".equalsIgnoreCase(uri.getScheme())) return null;
            String host = uri.getQueryParameter("host");
            String port = uri.getQueryParameter("port");
            String sid = uri.getQueryParameter("sid");
            String fp = uri.getQueryParameter("fp");
            String code = uri.getQueryParameter("code");
            String name = uri.getQueryParameter("name");
            if (host == null || port == null || fp == null || code == null) return null;
            int portNumber = Integer.parseInt(port);
            if (portNumber < 1 || portNumber > 65535) return null;
            return new PairingLink(host, portNumber, sid == null ? "" : sid, fp, code, name == null ? "DSH" : name);
        } catch (JSONException | RuntimeException error) {
            return null;
        }
    }
}
