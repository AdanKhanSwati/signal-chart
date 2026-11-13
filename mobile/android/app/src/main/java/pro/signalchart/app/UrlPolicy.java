package pro.signalchart.app;
import java.net.URI;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/** Incoming intents never change the trusted origin or authorize native actions. */
public final class UrlPolicy {
    private UrlPolicy() {}
    private static final Set<String> CUSTOMER_PATHS = new HashSet<>(Arrays.asList(
        "/app.html", "/terminal.html", "/dashboard.html", "/signals.html", "/account.html",
        "/billing.html", "/support.html", "/watchlist.html", "/analytics.html"));
    private static final Set<String> ADMIN_PATHS = new HashSet<>(Arrays.asList(
        "/ops.html", "/admin.html", "/account.html", "/support.html"));
    public static String sanitize(String value, String origin, String defaultPath, boolean admin) {
        String fallback = origin + defaultPath;
        if (value == null || value.length() > 8192) return fallback;
        try {
            URI uri = new URI(value), expected = new URI(origin);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 ||
                !expected.getHost().equalsIgnoreCase(uri.getHost()) ||
                !(admin ? ADMIN_PATHS : CUSTOMER_PATHS).contains(uri.getRawPath())) return fallback;
            return uri.toASCIIString();
        } catch (Exception ignored) { return fallback; }
    }
}
