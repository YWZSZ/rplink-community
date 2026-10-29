package com.rplink.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypted-at-rest list of paired computers. */
public final class ServerStore {
    private static final String TAG = "DshLinkStore";
    private static final String PREFS = "dsh_link_secure";
    private static final String BLOB = "servers";
    private static final String KEY_ALIAS = "dsh_link_store_key";

    private final SharedPreferences preferences;

    public ServerStore(Context context) {
        preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized List<ServerRecord> list() {
        List<ServerRecord> result = new ArrayList<>();
        String blob = preferences.getString(BLOB, "");
        if (blob == null || blob.isEmpty()) return result;
        try {
            byte[] plain = decrypt(blob);
            JSONArray array = new JSONArray(new String(plain, StandardCharsets.UTF_8));
            for (int index = 0; index < array.length(); index += 1) {
                result.add(ServerRecord.fromJson(array.getJSONObject(index)));
            }
        } catch (Exception error) {
            Log.w(TAG, "cannot read paired servers", error);
        }
        return result;
    }

    public ServerRecord find(String id) {
        if (id == null) return null;
        for (ServerRecord server : list()) {
            if (id.equals(server.id)) return server;
        }
        return null;
    }

    public synchronized void upsert(ServerRecord server) {
        List<ServerRecord> servers = list();
        boolean replaced = false;
        for (int index = 0; index < servers.size(); index += 1) {
            if (servers.get(index).id.equals(server.id)) {
                servers.set(index, server);
                replaced = true;
                break;
            }
        }
        if (!replaced) servers.add(server);
        write(servers);
    }

    public synchronized void remove(String id) {
        List<ServerRecord> servers = list();
        servers.removeIf(server -> server.id.equals(id));
        write(servers);
    }

    public synchronized void touch(String id) {
        List<ServerRecord> servers = list();
        for (ServerRecord server : servers) {
            if (server.id.equals(id)) {
                server.lastUsedAt = System.currentTimeMillis();
                write(servers);
                return;
            }
        }
    }

    private void write(List<ServerRecord> servers) {
        try {
            JSONArray array = new JSONArray();
            for (ServerRecord server : servers) array.put(server.toJson());
            preferences.edit().putString(BLOB, encrypt(array.toString().getBytes(StandardCharsets.UTF_8))).apply();
        } catch (Exception error) {
            Log.w(TAG, "cannot persist paired servers", error);
        }
    }

    private SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    private String encrypt(byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        if (iv == null) throw new IllegalStateException("Keystore did not return an IV");
        byte[] encrypted = cipher.doFinal(plain);
        byte[] combined = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private byte[] decrypt(String blob) throws Exception {
        byte[] combined = Base64.decode(blob, Base64.NO_WRAP);
        byte[] iv = new byte[12];
        System.arraycopy(combined, 0, iv, 0, iv.length);
        byte[] encrypted = new byte[combined.length - iv.length];
        System.arraycopy(combined, iv.length, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return cipher.doFinal(encrypted);
    }
}
