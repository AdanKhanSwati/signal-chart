package pro.signalchart.app;
import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
public final class PortalActivity extends LauncherActivity {
    @Override protected Uri getLaunchingUrl() {
        return Uri.parse(UrlPolicy.sanitize(getIntent().getDataString(), BuildConfig.PORTAL_ORIGIN,
            BuildConfig.START_PATH, BuildConfig.ADMIN_APP));
    }
}
