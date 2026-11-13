package pro.signalchart.app;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
public class UrlPolicyTest {
    private static final String ORIGIN = "https://signal-chart.auxwork3.workers.dev";
    private String customer(String url) { return UrlPolicy.sanitize(url, ORIGIN, "/app.html", false); }
    @Test public void preservesAuthCallback() {
        String url = ORIGIN + "/account.html?code=example#session"; assertEquals(url, customer(url));
    }
    @Test public void rejectsOriginAndSchemeConfusion() {
        for (String bad : new String[]{"javascript:alert(1)", "https://evil.example/app.html",
                ORIGIN + ".evil.example/app.html", "https://user@signal-chart.auxwork3.workers.dev/app.html",
                ORIGIN + ":443/app.html", "intent://app.html", "file:///account.html", null,
                ORIGIN + "/%2e%2e/ops.html", ORIGIN + "/ops.html", ORIGIN + "/api/cv-ops?action=approve"})
            assertEquals(ORIGIN + "/app.html", customer(bad));
    }
    @Test public void adminHasSeparateEntry() {
        assertEquals(ORIGIN + "/admin-login.html", UrlPolicy.sanitize(null, ORIGIN, "/admin-login.html", true));
        assertEquals(ORIGIN + "/ops.html#messages", UrlPolicy.sanitize(ORIGIN + "/ops.html#messages", ORIGIN, "/admin-login.html", true));
        assertEquals(ORIGIN + "/admin-login.html", UrlPolicy.sanitize(ORIGIN + "/account.html", ORIGIN, "/admin-login.html", true));
    }
}
