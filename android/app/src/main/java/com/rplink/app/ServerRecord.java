package com.rplink.app;

import org.json.JSONException;
import org.json.JSONObject;

public final class ServerRecord {
    public final String id;
    public final String name;
    public final String host;
    public final int port;
    public final String caPem;
    public final String token;
    public long lastUsedAt;

    public ServerRecord(String id, String name, String host, int port, String caPem, String token, long lastUsedAt) {
        this.id = id;
        this.name = name;
        this.host = host;
        this.port = port;
        this.caPem = caPem;
        this.token = token;
        this.lastUsedAt = lastUsedAt;
    }

    public String authority() {
        return host + ":" + port;
    }

    public String origin() {
        return "https://" + host + ":" + port;
    }

    public JSONObject toJson() throws JSONException {
        JSONObject object = new JSONObject();
        object.put("id", id);
        object.put("name", name);
        object.put("host", host);
        object.put("port", port);
        object.put("caPem", caPem);
        object.put("token", token);
        object.put("lastUsedAt", lastUsedAt);
        return object;
    }

    public static ServerRecord fromJson(JSONObject object) throws JSONException {
        return new ServerRecord(
                object.getString("id"),
                object.optString("name", "DSH"),
                object.getString("host"),
                object.getInt("port"),
                object.getString("caPem"),
                object.getString("token"),
                object.optLong("lastUsedAt", 0L)
        );
    }
}
