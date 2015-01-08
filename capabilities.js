define('capabilities', ['settings'], function(settings) {
    function safeMatchMedia(query) {
        var m = window.matchMedia(query);
        return !!m && m.matches;
    }

    function detectOS() {
        var macInfo = /Mac OS X 10[_\.](\d+)/
            .exec(navigator.userAgent);
        if (macInfo) {
            return {
                name: 'Mac OS X',
                version: [10, parseInt(macInfo[1], 10)],
            };
        } else {
            return {};
        }
    }

    var static_caps = {
        'JSON': window.JSON && typeof JSON.parse === 'function',
        'debug': document.location.href.indexOf('dbg') >= 0,
        'debug_in_page': document.location.href.indexOf('dbginpage') >= 0,
        'console': window.console && typeof window.console.log === 'function',
        'replaceState': typeof history.replaceState === 'function',
        'chromeless': !!(window.locationbar && !window.locationbar.visible),
        'webApps': !!(navigator.mozApps && navigator.mozApps.install),
        'packagedWebApps': !!(navigator.mozApps && navigator.mozApps.installPackage),
        'userAgent': navigator.userAgent,
        'widescreen': function() { return safeMatchMedia('(min-width: 710px)'); },
        'firefoxAndroid': navigator.userAgent.indexOf('Firefox') !== -1 && navigator.userAgent.indexOf('Android') !== -1,
        'touch': !!(('ontouchstart' in window) || window.DocumentTouch && document instanceof DocumentTouch),
        'performance': !!(window.performance || window.msPerformance || window.webkitPerformance || window.mozPerformance),
        'navPay': !!navigator.mozPay,
        'webactivities': !!(navigator.setMessageHandler || navigator.mozSetMessageHandler),
        'firefoxOS': navigator.mozApps && navigator.mozApps.installPackage &&
                     navigator.userAgent.indexOf('Android') === -1 &&
                     (navigator.userAgent.indexOf('Mobile') !== -1 || navigator.userAgent.indexOf('Tablet') !== -1),
        'phantom': navigator.userAgent.match(/Phantom/),  // Don't use this if you can help it.
        'os': detectOS(),
    };

    static_caps.nativeFxA = function() {
        return (static_caps.firefoxOS && window.location.protocol === 'app:' &&
                navigator.userAgent.match(/rv:(\d{2})/)[1] >= 34);

    };
    static_caps.yulelogFxA = function() {
        return (static_caps.firefoxOS && window.top !== window.self &&
                settings.switches.indexOf('native-firefox-accounts') !== -1 &&
                navigator.userAgent.match(/rv:(\d{2})/)[1] >= 34);
    };
    static_caps.fallbackFxA = function() {
        return (!(static_caps.nativeFxA() || static_caps.yulelogFxA()));
    };

    static_caps.device_type = function() {
        if (static_caps.firefoxOS) {
            return 'firefoxos';
        } else if (static_caps.firefoxAndroid) {
            if (static_caps.widescreen()) {  // TODO(buchets): Retire me
                return 'android-tablet';
            }
            return 'android-mobile';
        } else {
            return 'desktop';
        }
    };

    static_caps.device_platform = function() {
        // Remove "-tablet" and "-mobile" from android types.
        return static_caps.device_type().split('-')[0];
    };

    // OS X requires some extra work to install apps that aren't from the
    // App Store. See bug 1112275 for more info.
    static_caps.osXInstallIssues = static_caps.os.name === 'Mac OS X' &&
                                   static_caps.os.version[1] >= 9;

    return static_caps;

});
