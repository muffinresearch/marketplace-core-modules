define('login',
    ['cache', 'capabilities', 'defer', 'jquery', 'log', 'notification',
     'polyfill', 'settings', 'site_config', 'storage', 'underscore', 'urls',
     'user', 'utils', 'requests', 'z'],
    function(cache, capabilities, defer, $, log, notification,
             polyfill, settings, siteConfig, storage, _, urls,
             user, utils, requests, z) {

    var console = log('login');
    var fxa_popup;
    var pending_logins = [];
    var packaged_origin = "app://packaged." + window.location.host;
    function oncancel() {
        console.log('Login cancelled');
        z.page.trigger('login_cancel');
        _.invoke(pending_logins, 'reject');
        pending_logins = [];
    }

    function signOutNotification() {
        notification.notification({message: gettext('You have been signed out')});
    }

    function signInNotification() {
        notification.notification({message: gettext('You have been signed in')});
    }

    function logOut() {
        cache.flush_signed();
        user.clear_token();

        z.body.removeClass('logged-in');
        z.page.trigger('reload_chrome').trigger('before_logout');
        if (!z.context.dont_reload_on_login) {
            z.page.trigger('logged_out');
            signOutNotification();
            require('views').reload();
        } else {
            console.log('Reload on logout aborted by current view');
        }
    }

    function logIn(data) {
        var should_reload = !user.logged_in();

        user.set_token(data.token, data.settings);
        user.update_permissions(data.permissions);
        user.update_apps(data.apps);
        console.log('Login succeeded, preparing the app');

        z.body.addClass('logged-in');
        $('.loading-submit').removeClass('loading-submit');
        z.page.trigger('reload_chrome').trigger('logged_in');

        function resolve_pending() {
            _.invoke(pending_logins, 'resolve');
            pending_logins = [];
        }

        if (should_reload && !z.context.dont_reload_on_login) {
            require('views').reload().done(function() {
                resolve_pending();
                signInNotification();
            });
        } else {
            console.log('Reload on login aborted by current view');
        }
    }

    function logInFailed(message) {
        message = message || gettext('Sign in failed');
        notification.notification({message: message});
        $('.loading-submit').removeClass('loading-submit');
        z.page.trigger('login_fail');
        _.invoke(pending_logins, 'reject');
        pending_logins = [];
    }

    z.body.on('click', '.persona', function(e) {
        e.preventDefault();

        var $this = $(this);
        $this.addClass('loading-submit');
        startLogin({register: $this.hasClass('register')}).always(function() {
            $this.removeClass('loading-submit').trigger('blur');
        });

    }).on('click', '.logout', utils._pd(function(e) {
        requests.del(urls.api.url('logout'));

        if (capabilities.fallbackFxA()) {
            logOut();
        }
    }));

    function getCenteredCoordinates(width, height) {
        var x = window.screenX + Math.max(0, Math.floor((window.innerWidth - width) / 2));
        var y = window.screenY + Math.max(0, Math.floor((window.innerHeight - height) / 2));
        return [x, y];
    }

    function startLogin(options) {
        var w = 320;
        var h = 600;
        var i = getCenteredCoordinates(w, h);
        var def = defer.Deferred();
        pending_logins.push(def);
        var opt = {register: false};
        // Override our settings with the provided ones.
        _.extend(opt, options);
        if (capabilities.yulelogFxA()) {
            window.top.postMessage({type: 'fxa-request'}, packaged_origin);
        } else if (capabilities.fallbackFxA()) {
            var fxa_url;
            if (user.migration_enabled()) {
                fxa_url = '/fxa-migration';
                save_fxa_auth_url(settings.fxa_auth_url);
            } else {
                fxa_url = settings.fxa_auth_url;
            }
            if (opt.register) {
                fxa_url = utils.urlparams(fxa_url, {action: 'signup'});
            }
            fxa_popup = window.open(
                fxa_url,
                'fxa',
                'scrollbars=yes,width=' + w + ',height=' + h +
                ',left=' + i[0] + ',top=' + i[1]);

            // The same-origin policy prevents us from listening to events to
            // know when the cross-origin FxA popup was closed. And we can't
            // listen to `focus` on the main window because, unlike Chrome,
            // Firefox does not fire `focus` when a popup is closed (presumably
            // because the page never truly lost focus).
            var popup_interval = setInterval(function() {
                if (!fxa_popup || fxa_popup.closed) {
                    // The oncancel was cancelling prematurely when window is closed,
                    // prevents review dialog from popping up on login success.
                    // oncancel();
                    $('.loading-submit').removeClass('loading-submit').trigger('blur');
                    clearInterval(popup_interval);
                } else {
                    // If login dialog ends up behind another window, we want
                    // to bring it to the front, otherwise it looks like login
                    // is stuck / broken.
                    fxa_popup.focus();
                }
            }, 150);
        } else {
            console.log('Requesting login from Native FxA');
            navigator.mozId.request({oncancel: oncancel});
        }
        return def.promise();
    }

    function gotVerifiedEmail(assertion) {
        console.log('Got assertion from FxA');
        var aud;
        if (capabilities.yulelogFxA()) {
            aud = packaged_origin;
        } else {
            aud = window.location.origin;
        }
        var data = {
            assertion: assertion,
            audience: aud,
        };

        z.page.trigger('before_login');

        requests.post(urls.api.url('login'), data)
                .done(logIn)
                .fail(function(jqXHR, textStatus, error) {
            console.warn('Assertion verification failed!', textStatus, error);

            var err = jqXHR.responseText;
            // Catch-all for XHR errors otherwise we'll trigger a notification
            // with its message as one of the error templates.
            if (jqXHR.status != 200) {
                err = gettext('FxA login failed. A server error was encountered.');
            }
            logInFailed(err);
        });
    }

    function startNativeFxA() {
        var email = user.get_setting('email') || '';
        if (email) {
            console.log('Detected user', email);
        } else {
            console.log('No previous user detected');
        }
        console.log('Calling navigator.mozId.watch');
        navigator.mozId.watch({
            wantIssuer: 'firefox-accounts',
            loggedInUser: email,
            // This lets us change the cursor for the "Sign in" link.
            onready: function() {z.body.addClass('persona-loaded');},
            onlogin: gotVerifiedEmail,
            onlogout: function() {
                z.body.removeClass('logged-in');
                z.page.trigger('reload_chrome').trigger('logout');
            }
        });
    }

    function registerFxAPostMessageHandler() {
        window.addEventListener('message', function (msg) {
            var valid_origins = [settings.api_url, window.location.origin];
            if (msg.data && msg.data.auth_code &&
                    valid_origins.indexOf(msg.origin) !== -1) {
                handle_fxa_login(msg.data.auth_code);
            }
        });
    }

    siteConfig.promise.done(function(data) {
        if (capabilities.yulelogFxA()) {
            console.log("setting up yulelog-fxa");
            window.addEventListener('message', function (msg) {
                if (!msg.data || !msg.data.type || msg.origin !== packaged_origin) {
                    return;
                }
                console.log("fxa message " + JSON.stringify(msg.data));
                if (msg.data.type === 'fxa-login') {
                    gotVerifiedEmail(msg.data.assertion);
                } else if (msg.data.type === 'fxa-logout') {
                    logOut();
                } else if (msg.data.type === 'fxa-cancel') {
                    oncancel();
                }
            });
            window.top.postMessage({type: 'fxa-watch',
                                    email: user.get_setting('email') || ''},
                                   packaged_origin);
        } else if (!capabilities.fallbackFxA()) {
            startNativeFxA();
        } else {
            // This lets us change the cursor for the "Sign in" link.
            z.body.addClass('persona-loaded');
            // Register the "message" handler here to avoid it being registered
            // multiple times.
            registerFxAPostMessageHandler();
        }
    });

    var fxa_auth_url_key = 'fxa_auth_url';
    function save_fxa_auth_url(url) {
        storage.setItem(fxa_auth_url_key, url);
    }

    function get_fxa_auth_url() {
        return storage.getItem(fxa_auth_url_key);
    }

    function handle_fxa_login(auth_code, state) {
        var loginData = {
            'auth_response': auth_code,
            'state': state || settings.fxa_auth_state,
        };
        // Check for a host secific client_id override. See site_config.js for
        // more info.
        var clientIdOverride = siteConfig.fxa_client_id_for_origin();
        if (clientIdOverride) {
            loginData.client_id = clientIdOverride;
        }
        z.page.trigger('before_login');
        requests.post(urls.api.url('fxa-login'), loginData)
                .done(logIn)
                .fail(function(jqXHR, textStatus, error) {
            console.warn('FxA login failed', jqXHR, textStatus, error);
            logInFailed();
        });
    }

    return {
        login: startLogin,
        get_fxa_auth_url: get_fxa_auth_url,
        handle_fxa_login: handle_fxa_login,
    };
});
