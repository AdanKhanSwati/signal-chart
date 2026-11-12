package pro.signalchart.app;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Connection recovery is native. Browser owns login, cookies and file selection. */
public final class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) { super.onCreate(state); openPortal(); }
    private void openPortal() {
        ConnectivityManager manager = getSystemService(ConnectivityManager.class);
        NetworkCapabilities network = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        if (network == null || !network.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) { showRecovery(false); return; }
        Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.PORTAL_ORIGIN));
        if (browser.resolveActivity(getPackageManager()) == null) { showRecovery(true); return; }
        String target = UrlPolicy.sanitize(getIntent().getDataString(), BuildConfig.PORTAL_ORIGIN, BuildConfig.START_PATH, BuildConfig.ADMIN_APP);
        try {
            startActivity(new Intent(this, PortalActivity.class).setData(Uri.parse(target))); finish();
        } catch (ActivityNotFoundException ignored) { showRecovery(true); }
    }
    private void showRecovery(boolean browserMissing) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL); content.setGravity(Gravity.CENTER_VERTICAL);
        int space = Math.round(28 * getResources().getDisplayMetrics().density);
        content.setPadding(space, space, space, space); content.setBackgroundColor(Color.rgb(23, 24, 32));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(space + insets.getSystemWindowInsetLeft(), space + insets.getSystemWindowInsetTop(),
                space + insets.getSystemWindowInsetRight(), space + insets.getSystemWindowInsetBottom()); return insets;
        });
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.brand_icon);
        logo.setContentDescription(getString(R.string.app_name)); content.addView(logo, new LinearLayout.LayoutParams(space * 3, space * 3));
        TextView title = new TextView(this); title.setText(browserMissing ? R.string.browser_title : R.string.offline_title);
        title.setTextSize(30); title.setTextColor(Color.WHITE); title.setPadding(0, space, 0, space / 2); content.addView(title);
        TextView message = new TextView(this); message.setText(browserMissing ? R.string.browser_message : R.string.offline_message);
        message.setTextSize(16); message.setTextColor(Color.rgb(190, 191, 199)); message.setPadding(0, 0, 0, space); content.addView(message);
        Button retry = new Button(this); retry.setText(R.string.retry); retry.setOnClickListener(view -> openPortal()); content.addView(retry);
        Button settings = new Button(this); settings.setText(browserMissing ? R.string.app_settings : R.string.connection_settings);
        settings.setOnClickListener(view -> {
            try { startActivity(new Intent(browserMissing ? Settings.ACTION_MANAGE_APPLICATIONS_SETTINGS : Settings.ACTION_WIRELESS_SETTINGS)); }
            catch (ActivityNotFoundException ignored) { /* Keep the retry action available. */ }
        });
        content.addView(settings); setContentView(content); content.requestApplyInsets();
    }
}
