package io.github.insanephin.hlsmultiview;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Message;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ChzzkNative")
public class ChzzkNativePlugin extends Plugin {
    private static final String LOGIN_COOKIE = "NID_AUT=";
    private static final int BG = Color.rgb(0x14, 0x15, 0x17);

    private final ExecutorService io = Executors.newFixedThreadPool(4);
    private final Map<String, WebView> chats = new HashMap<>();
    private final Map<WebView, String> homes = new HashMap<>();
    private final List<View> sheets = new ArrayList<>();
    private FrameLayout overlay;
    private OnBackPressedCallback backCallback;
    private PluginCall loginCall;
    private Boolean lastLoggedIn;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            CookieManager.getInstance().setAcceptCookie(true);
            backCallback = new OnBackPressedCallback(false) {
                @Override
                public void handleOnBackPressed() {
                    closeTopSheet();
                }
            };
            getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), backCallback);
        });
    }

    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) {
            call.reject("invalid url");
            return;
        }
        io.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("User-Agent", browserUserAgent(WebSettings.getDefaultUserAgent(getContext())));
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) conn.setRequestProperty("Cookie", cookies);
                int status = conn.getResponseCode();
                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("text", in == null ? "" : readAll(in));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String browserUserAgent(String ua) {
        return ua.replace("; wv)", ")").replaceAll(" Version/[\\d.]+", "");
    }

    @PluginMethod
    public void chatOpen(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("invalid arguments");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (!chats.containsKey(id)) {
                WebView view = makeWebView();
                view.setVisibility(View.GONE);
                overlay().addView(view, 0, new FrameLayout.LayoutParams(0, 0));
                chats.put(id, view);
                homes.put(view, url);
                view.loadUrl(url);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void chatShow(PluginCall call) {
        String id = call.getString("id");
        double x = call.getDouble("x", 0.0), y = call.getDouble("y", 0.0);
        double w = call.getDouble("width", 0.0), h = call.getDouble("height", 0.0);
        getActivity().runOnUiThread(() -> {
            float d = getContext().getResources().getDisplayMetrics().density;
            WebView host = getBridge().getWebView();
            for (Map.Entry<String, WebView> e : chats.entrySet()) {
                WebView view = e.getValue();
                boolean show = e.getKey().equals(id);
                view.setVisibility(show ? View.VISIBLE : View.GONE);
                if (show) {
                    FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round((float) w * d), Math.round((float) h * d));
                    lp.leftMargin = host.getLeft() + host.getPaddingLeft() + Math.round((float) x * d);
                    lp.topMargin = host.getTop() + host.getPaddingTop() + Math.round((float) y * d);
                    view.setLayoutParams(lp);
                }
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void chatClose(PluginCall call) {
        String id = call.getString("id", "");
        getActivity().runOnUiThread(() -> {
            WebView view = chats.remove(id);
            if (view != null) {
                homes.remove(view);
                destroy(view);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void chatReloadAll(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            for (WebView view : chats.values()) view.reload();
            call.resolve();
        });
    }

    private FrameLayout overlay() {
        if (overlay == null) {
            WebView host = getBridge().getWebView();
            ViewGroup parent = (ViewGroup) host.getParent();
            overlay = new FrameLayout(getContext());
            parent.addView(overlay, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        return overlay;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView makeWebView() {
        WebView view = new WebView(getContext());
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setUserAgentString(browserUserAgent(s.getUserAgentString()));
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        view.setBackgroundColor(BG);
        view.setWebViewClient(new Client());
        view.setWebChromeClient(new Chrome());
        return view;
    }

    private void destroy(WebView view) {
        ViewGroup parent = (ViewGroup) view.getParent();
        if (parent != null) parent.removeView(view);
        view.stopLoading();
        view.destroy();
    }

    private static boolean isNaverUrl(Uri uri) {
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null) return false;
        return host.equals("naver.com") || host.endsWith(".naver.com") || host.equals("naver.net") || host.endsWith(".naver.net");
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"https".equals(scheme) && !"http".equals(scheme)) return;
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {}
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String home = homes.get(view);
            if (home != null) {
                if (uri.toString().startsWith(home)) return false;
                if (isNaverUrl(uri)) openSheet(uri.toString(), null);
                else openExternal(uri);
                return true;
            }
            if (isNaverUrl(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (homes.get(view) == null) checkAuth(view, url);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(openSheet(null, "치지직"));
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            for (View sheet : new ArrayList<>(sheets)) {
                if (sheet.getTag() == window) closeSheet(sheet);
            }
        }
    }

    private WebView openSheet(String url, String title) {
        WebView web = makeWebView();
        LinearLayout sheet = new LinearLayout(getContext());
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setBackgroundColor(BG);
        sheet.setClickable(true);
        sheet.setTag(web);

        float d = getContext().getResources().getDisplayMetrics().density;
        FrameLayout bar = new FrameLayout(getContext());
        TextView label = new TextView(getContext());
        label.setText(title == null ? "치지직" : title);
        label.setTextColor(Color.WHITE);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        bar.addView(label, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        TextView close = new TextView(getContext());
        close.setText("닫기");
        close.setTextColor(Color.rgb(0x00, 0xff, 0xa3));
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        close.setPadding(Math.round(16 * d), 0, Math.round(16 * d), 0);
        close.setGravity(Gravity.CENTER);
        close.setOnClickListener((v) -> closeSheet(sheet));
        bar.addView(close, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END));
        sheet.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.round(48 * d)));
        sheet.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        ViewCompat.setOnApplyWindowInsetsListener(sheet, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            v.setPadding(0, 0, 0, bars.bottom);
            return insets;
        });
        overlay().addView(sheet, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.requestApplyInsets(sheet);
        sheets.add(sheet);
        backCallback.setEnabled(true);
        if (url != null) web.loadUrl(url);
        return web;
    }

    private void closeTopSheet() {
        if (!sheets.isEmpty()) closeSheet(sheets.get(sheets.size() - 1));
    }

    private void closeSheet(View sheet) {
        if (!sheets.remove(sheet)) return;
        destroy((WebView) sheet.getTag());
        ((ViewGroup) sheet.getParent()).removeView(sheet);
        backCallback.setEnabled(!sheets.isEmpty());
        CookieManager.getInstance().flush();
        if (sheets.isEmpty() && loginCall != null) {
            loginCall.resolve();
            loginCall = null;
        }
        checkAuth(null, null);
    }

    @PluginMethod
    public void authState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("loggedIn", isLoggedIn());
        ret.put("persistent", JSObject.NULL);
        call.resolve(ret);
    }

    @PluginMethod
    public void login(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("invalid url");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (loginCall != null) loginCall.resolve();
            loginCall = call;
            openSheet(url, "치지직 로그인");
        });
    }

    @PluginMethod
    public void logout(PluginCall call) {
        getActivity().runOnUiThread(() ->
            CookieManager.getInstance().removeAllCookies((removed) -> {
                CookieManager.getInstance().flush();
                WebStorage.getInstance().deleteAllData();
                checkAuth(null, null);
                call.resolve();
            })
        );
    }

    private static boolean isLoggedIn() {
        String cookies = CookieManager.getInstance().getCookie("https://nid.naver.com/");
        return cookies != null && (cookies.startsWith(LOGIN_COOKIE) || cookies.contains("; " + LOGIN_COOKIE));
    }

    private void checkAuth(WebView sheetWeb, String url) {
        boolean loggedIn = isLoggedIn();
        if (lastLoggedIn == null || lastLoggedIn != loggedIn) {
            lastLoggedIn = loggedIn;
            JSObject data = new JSObject();
            data.put("loggedIn", loggedIn);
            data.put("persistent", JSObject.NULL);
            notifyListeners("auth", data);
        }
        if (loggedIn && loginCall != null && sheetWeb != null && url != null && "chzzk.naver.com".equals(Uri.parse(url).getHost())) {
            CookieManager.getInstance().flush();
            sheetWeb.postDelayed(() -> {
                for (View sheet : new ArrayList<>(sheets)) {
                    if (sheet.getTag() == sheetWeb) closeSheet(sheet);
                }
            }, 800);
        }
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdownNow();
        for (WebView view : chats.values()) destroy(view);
        chats.clear();
        homes.clear();
    }
}
