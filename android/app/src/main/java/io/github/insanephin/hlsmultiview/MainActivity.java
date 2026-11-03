package io.github.insanephin.hlsmultiview;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChzzkNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
