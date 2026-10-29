package com.rplink.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

public final class PairActivity extends AppCompatActivity {
    public static final String EXTRA_AUTO_PASTE = "auto_paste";
    private static final int REQUEST_CAMERA = 21;

    private EditText linkInput;
    private Button scanButton;
    private Button submitButton;
    private ProgressBar progress;
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_pair);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
            getSupportActionBar().setTitle(R.string.pair_title);
        }
        linkInput = findViewById(R.id.pair_link);
        scanButton = findViewById(R.id.pair_scan);
        submitButton = findViewById(R.id.pair_submit);
        progress = findViewById(R.id.pair_progress);
        status = findViewById(R.id.pair_status);
        scanButton.setOnClickListener(view -> startScan());
        submitButton.setOnClickListener(view -> submit(linkInput.getText().toString()));
        if (getIntent().getBooleanExtra(EXTRA_AUTO_PASTE, false)) pasteFromClipboard();
        handleDeepLink(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleDeepLink(intent);
    }

    @Override
    public boolean onSupportNavigateUp() {
        finish();
        return true;
    }

    private void handleDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String raw = intent.getData().toString();
        linkInput.setText(raw);
        startPairing(PairingLink.parse(raw));
    }

    private void pasteFromClipboard() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        ClipData clip = clipboard == null ? null : clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) {
            status.setText("剪贴板里没有内容。请在电脑端复制配对链接。");
            return;
        }
        CharSequence text = clip.getItemAt(0).coerceToText(this);
        linkInput.setText(text);
        startPairing(PairingLink.parse(text.toString()));
    }

    private void startScan() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQUEST_CAMERA);
            return;
        }
        launchScanner();
    }

    private void launchScanner() {
        IntentIntegrator integrator = new IntentIntegrator(this);
        integrator.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
        integrator.setPrompt("扫描电脑上的配对二维码");
        integrator.setBeepEnabled(false);
        integrator.setOrientationLocked(false);
        integrator.initiateScan();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_CAMERA) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) launchScanner();
        else status.setText("需要相机权限才能扫码；也可以粘贴配对链接。");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        String raw = result == null ? null : result.getContents();
        if (raw != null && !raw.isEmpty()) {
            linkInput.setText(raw);
            startPairing(PairingLink.parse(raw));
        }
    }

    private void submit(String raw) {
        PairingLink link = PairingLink.parse(raw);
        if (link == null) {
            status.setText("链接格式不正确。请扫描电脑端生成的二维码，或粘贴完整的 rplink://pair?… 链接。");
            return;
        }
        startPairing(link);
    }

    private void startPairing(PairingLink link) {
        if (link == null) {
            status.setText("链接格式不正确。请重新扫描电脑端二维码。");
            return;
        }
        setBusy(true);
        status.setText("正在验证电脑证书并配对…");
        PairingClient.pair(this, link, new PairingClient.Callback() {
            @Override
            public void onSuccess(ServerRecord server) {
                ServerStore store = new ServerStore(PairActivity.this);
                store.upsert(server);
                if (store.find(server.id) == null) {
                    setBusy(false);
                    status.setText("配对成功，但本机保存失败。请重试。");
                    return;
                }
                setBusy(false);
                status.setText("配对成功：" + server.name);
                setResult(RESULT_OK);
                Intent next = new Intent(PairActivity.this, ServerListActivity.class);
                next.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(next);
                finish();
            }

            @Override
            public void onError(String message, Throwable error) {
                setBusy(false);
                status.setText(message);
                new AlertDialog.Builder(PairActivity.this)
                        .setTitle(R.string.pair_failed)
                        .setMessage(message)
                        .setPositiveButton("知道了", null)
                        .show();
            }
        });
    }

    private void setBusy(boolean busy) {
        progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        scanButton.setEnabled(!busy);
        submitButton.setEnabled(!busy);
        linkInput.setEnabled(!busy);
    }
}
