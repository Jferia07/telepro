package com.telepro.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.telepro.core.TeleServer;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final int PICK_FILE = 1001;
    private static final int PORT = 8765;
    private static TeleServer server;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private volatile boolean captureKeys;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        setContentView(web);

        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setTextZoom(100);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(false);
        ws.setMediaPlaybackRequiresUserGesture(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "Native");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return url == null || !url.startsWith("http://127.0.0.1:");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Importar guion"), PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        startServerAndLoad();
    }

    private void startServerAndLoad() {
        final Context app = getApplicationContext();
        new Thread(new Runnable() {
            @Override
            public void run() {
                String error = null;
                try {
                    synchronized (MainActivity.class) {
                        if (server == null) {
                            TeleServer s = new TeleServer(new TeleServer.Assets() {
                                @Override
                                public InputStream open(String path) throws IOException {
                                    return app.getAssets().open("web/" + path);
                                }
                            }, new File(app.getFilesDir(), "telepro"));
                            s.start(PORT);
                            server = s;
                        }
                    }
                } catch (Exception e) {
                    error = String.valueOf(e.getMessage());
                }
                final String err = error;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (err != null) {
                            Toast.makeText(MainActivity.this, "No se pudo iniciar TelePro: " + err, Toast.LENGTH_LONG).show();
                        } else {
                            web.loadUrl("http://127.0.0.1:" + server.getPort() + "/");
                        }
                    }
                });
            }
        }, "telepro-start").start();
    }

    /** Funciones del sistema que la interfaz puede usar. */
    public class Bridge {
        @JavascriptInterface
        public void setCaptureKeys(final boolean on) {
            captureKeys = on;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applySystemBars();
                }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip()) return "";
                ClipData clip = cm.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) return "";
                CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    /** Envía a la interfaz las teclas del mando Bluetooth (incluye volumen y teclas multimedia). */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        if (captureKeys && code != KeyEvent.KEYCODE_BACK && web != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) {
                String name = KeyEvent.keyCodeToString(code);
                boolean repeat = e.getRepeatCount() > 0;
                web.evaluateJavascript("window.onNativeKey&&window.onNativeKey('" + name + "'," + repeat + ")", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("window.onNativeBack?window.onNativeBack():'exit'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v != null && v.contains("exit")) moveTaskToBack(true);
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applySystemBars();
    }

    /** Pantalla completa solo al presentar; en el editor se dejan las barras para que el teclado no tape el texto. */
    @SuppressWarnings("deprecation")
    private void applySystemBars() {
        View decor = getWindow().getDecorView();
        if (captureKeys) {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("window.onNativePause&&window.onNativePause()", null);
    }
}
