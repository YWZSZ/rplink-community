package com.rplink.app;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

/** Server/app settings: re-pair, unpair, version. */
public final class SettingsActivity extends AppCompatActivity {
    public static final String EXTRA_SERVER_ID = "server_id";

    private ServerRecord server;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private EditText delayMinInput;
    private EditText delayMaxInput;
    private Button delaySaveButton;
    private boolean destroyed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ServerStore store = new ServerStore(this);
        String serverId = getIntent().getStringExtra(EXTRA_SERVER_ID);
        server = serverId == null || serverId.isEmpty() ? null : store.find(serverId);
        if (server == null && !store.list().isEmpty()) server = store.list().get(0);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0B1220"));
        root.setPadding(dp(22), dp(24), dp(22), dp(24));

        TextView title = new TextView(this);
        title.setText("设置");
        title.setTextColor(Color.parseColor("#EEF2F8"));
        title.setTextSize(26);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);

        if (server == null) {
            TextView empty = new TextView(this);
            empty.setText("还没有配对电脑。");
            empty.setTextColor(Color.parseColor("#9AA8BD"));
            empty.setTextSize(14);
            empty.setPadding(0, dp(18), 0, 0);
            root.addView(empty);
        } else {
            TextView name = new TextView(this);
            name.setText(server.name);
            name.setTextColor(Color.parseColor("#EEF2F8"));
            name.setTextSize(18);
            name.setPadding(0, dp(18), 0, dp(4));
            root.addView(name);

            TextView host = new TextView(this);
            host.setText(server.host + ":" + server.port);
            host.setTextColor(Color.parseColor("#9AA8BD"));
            host.setTextSize(13);
            root.addView(host);

            TextView fingerprint = new TextView(this);
            fingerprint.setText("CA " + shortFingerprint(server));
            fingerprint.setTextColor(Color.parseColor("#66748A"));
            fingerprint.setTextSize(11);
            fingerprint.setPadding(0, dp(6), 0, dp(18));
            root.addView(fingerprint);

            addDelaySettings(root);

            Button pair = new Button(this);
            pair.setText("重新配对");
            pair.setOnClickListener(view -> {
                startActivity(new Intent(this, PairActivity.class));
                finish();
            });
            root.addView(pair);

            Button remove = new Button(this);
            remove.setText("删除这台电脑");
            remove.setTextColor(Color.parseColor("#FF7B8A"));
            remove.setOnClickListener(view -> confirmRemove(store));
            root.addView(remove);
        }

        TextView version = new TextView(this);
        version.setText("RPLink " + BuildConfig.VERSION_NAME);
        version.setTextColor(Color.parseColor("#66748A"));
        version.setTextSize(12);
        version.setPadding(0, dp(28), 0, 0);
        root.addView(version);

        setContentView(root);
        if (getSupportActionBar() != null) getSupportActionBar().hide();
        if (server != null) loadDelaySettings();
    }

    private void addDelaySettings(LinearLayout root) {
        TextView label = new TextView(this);
        label.setText("回复延迟");
        label.setTextColor(Color.parseColor("#EEF2F8"));
        label.setTextSize(16);
        label.setTypeface(null, android.graphics.Typeface.BOLD);
        label.setPadding(0, dp(20), 0, dp(6));
        root.addView(label);

        TextView minLabel = new TextView(this);
        minLabel.setText("下限（秒，0 = 不加延迟）");
        minLabel.setTextColor(Color.parseColor("#9AA8BD"));
        minLabel.setTextSize(12);
        root.addView(minLabel);

        delayMinInput = new EditText(this);
        delayMinInput.setHint("下限（秒），0 = 不加延迟");
        delayMinInput.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        delayMinInput.setTextColor(Color.parseColor("#EEF2F8"));
        delayMinInput.setHintTextColor(Color.parseColor("#66748A"));
        root.addView(delayMinInput);

        TextView maxLabel = new TextView(this);
        maxLabel.setText("上限（秒）");
        maxLabel.setTextColor(Color.parseColor("#9AA8BD"));
        maxLabel.setTextSize(12);
        maxLabel.setPadding(0, dp(8), 0, 0);
        root.addView(maxLabel);

        delayMaxInput = new EditText(this);
        delayMaxInput.setHint("上限（秒）");
        delayMaxInput.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        delayMaxInput.setTextColor(Color.parseColor("#EEF2F8"));
        delayMaxInput.setHintTextColor(Color.parseColor("#66748A"));
        root.addView(delayMaxInput);

        delaySaveButton = new Button(this);
        delaySaveButton.setText("保存延迟");
        delaySaveButton.setOnClickListener(view -> saveDelaySettings());
        root.addView(delaySaveButton);
    }

    private void loadDelaySettings() {
        executor.execute(() -> {
            try {
                JSONObject result = request("GET", "/api/settings", null);
                JSONObject settings = result.optJSONObject("settings");
                double min = settings == null ? 0 : settings.optDouble("replyDelayMinMs", 0) / 1000.0;
                double max = settings == null ? 0 : settings.optDouble("replyDelayMaxMs", 0) / 1000.0;
                main.post(() -> {
                    if (destroyed) return;
                    delayMinInput.setText(formatSeconds(min));
                    delayMaxInput.setText(formatSeconds(max));
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (!destroyed) Toast.makeText(this, "读取设置失败", Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private void saveDelaySettings() {
        double min = parseSeconds(delayMinInput);
        double max = parseSeconds(delayMaxInput);
        if (max < min) max = min;
        final int minMs = (int) Math.round(min * 1000);
        final int maxMs = (int) Math.round(max * 1000);
        delaySaveButton.setEnabled(false);
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("replyDelayMinMs", minMs);
                body.put("replyDelayMaxMs", maxMs);
                request("POST", "/api/settings", body);
                main.post(() -> {
                    if (destroyed) return;
                    delaySaveButton.setEnabled(true);
                    Toast.makeText(this, "回复延迟已保存", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                main.post(() -> {
                    if (destroyed) return;
                    delaySaveButton.setEnabled(true);
                    Toast.makeText(this, "保存失败", Toast.LENGTH_SHORT).show();
                });
            }
        });
    }

    private double parseSeconds(EditText input) {
        try {
            return Math.max(0, Math.min(120, Double.parseDouble(input.getText().toString().trim())));
        } catch (Exception error) {
            return 0;
        }
    }

    private String formatSeconds(double value) {
        if (Math.abs(value - Math.round(value)) < 0.0001) return String.valueOf(Math.round(value));
        return String.valueOf(value);
    }

    private JSONObject request(String method, String path, JSONObject body) throws Exception {
        HttpsURLConnection connection = TlsSupport.open(
                server.host, server.port, server.caPem, path, server.token, 8000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("x-rp-token", server.token);
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(bytes);
            }
        }
        int status = connection.getResponseCode();
        java.io.InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String text = TlsSupport.readAll(stream);
        connection.disconnect();
        if (status != 200) throw new IllegalStateException("HTTP " + status);
        return new JSONObject(text);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        executor.shutdownNow();
        super.onDestroy();
    }

    private void confirmRemove(ServerStore store) {
        new AlertDialog.Builder(this)
                .setTitle("删除这台电脑？")
                .setMessage("手机上的配对记录会删除；电脑端仍可在 RPLink 设置里移除设备。")
                .setNegativeButton("取消", null)
                .setPositiveButton("删除", (dialog, which) -> {
                    store.remove(server.id);
                    Intent next = new Intent(this, ServerListActivity.class);
                    next.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    startActivity(next);
                    finish();
                })
                .show();
    }

    private String shortFingerprint(ServerRecord record) {
        try {
            X509Certificate ca = TlsSupport.parseCertificate(record.caPem);
            String fingerprint = TlsSupport.fingerprint(ca);
            return fingerprint.substring(0, 16) + "…";
        } catch (Exception error) {
            return "—";
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
