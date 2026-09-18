        // --- Configuration ---
        // تم الانتقال من Google Apps Script + Google Sheets إلى Firebase Realtime Database
        // كل منطق المزامنة، الـ opsVersion، الإشعارات... إلخ باقٍ كما هو تماماً،
        // تم فقط استبدال طبقة الاتصال بالسحابة.
        const firebaseConfig = {
            apiKey: "AIzaSyDHjNvsMszkSaMFcbyP9oBKtMtT5x8Z5EE",
            authDomain: "restaevents-eeffb.firebaseapp.com",
            databaseURL: "https://restaevents-eeffb-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "restaevents-eeffb",
            storageBucket: "restaevents-eeffb.firebasestorage.app",
            messagingSenderId: "689779466978",
            appId: "1:689779466978:web:c9eff234c04df512fc34bb",
            measurementId: "G-FLWHW5PY98"
        };
        firebase.initializeApp(firebaseConfig);
        const db = firebase.database();
        const CLOUD_ENABLED = true; // Firebase مفعّل دائماً (بديل عن فحص وجود رابط GAS القديم)
        // آخر قيمة معروفة لـ meta/updatedAt — تُستخدم في الاشتراك اللحظي لتفادي إعادة
        // مزامنة غير ضرورية عندما يكون التغيير صادراً من كتابتنا نحن أنفسنا
        let _lastKnownUpdatedAt = null;

        const ADMIN_EMAIL = "salama.m@gmail.com";

        // منع تغيير قيمة حقول الأرقام (input type="number") بالخطأ عن طريق سكرول
        // عجلة الماوس أثناء التركيز عليها — الحقول لسه بتتعدل عادي بالكيبورد أو
        // بالأسهم الصغيرة الموجودة في الحقل، وسكرول الصفحة نفسها بيفضل شغال عادي.
        document.addEventListener('wheel', function(e) {
            if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'number') {
                document.activeElement.blur();
            }
        }, { passive: true });

        // --- إعدادات باقات الأفراح والخطوبة (افتراضية — تُستبدل بإعدادات الأدمن من السحابة إن وُجدت) ---
        const DEFAULT_WEDDING_PACKAGES = [
            { id: 'silver',   name: 'الفضي',     price: 250,  menuItems: [
                'مياه غازية + مياه معدنية',
                'قطعة جاتوة — مينى بيتزا — باتون ساليه',
                'تورتة العروسين ثلاثة أدوار',
            ], menuNotes: '' },
            { id: 'gold',     name: 'الذهبي',    price: 300,  menuItems: [
                'مياه غازية + مياه معدنية',
                '2 قطعة جاتوة — مينى بيتزا — باتون ساليه',
                'تورتة العروسين ثلاثة أدوار',
            ], menuNotes: '' },
            { id: 'diamond',  name: 'الماسي',    price: 400,  menuItems: [
                'مياه غازية + مياه معدنية',
                'ساندويتش دجاج — باتون ساليه — مينى بيتزا — قطعة جاتوة',
                'تورتة العروسين ثلاثة أدوار',
            ], menuNotes: '' },
            { id: 'royal',    name: 'الملكي',    price: 550,  menuItems: [
                'مياه غازية + مياه معدنية',
                '2 ساندويتش دجاج + كفتة — باتون ساليه — مينى بيتزا — قطعة جاتوة',
                'تورتة العروسين خمسة أدوار',
            ], menuNotes: '' },
            { id: 'elegance', name: 'إليجانس',   price: 1000, menuItems: [
                'مياه غازية + مياه معدنية',
                'طبق سلاطات مشكلة',
                'مشويات مشكلة: كفتة — دجاج — ستيك مع أرز شرقى',
                'قطعتا جاتوة',
                'تورتة العروسين خمسة أدوار',
            ], menuNotes: '' },
            { id: 'prestige', name: 'بريستيج',   price: 1300, menuItems: [
                'مياه غازية + مياه معدنية',
                'بوفيه سلطات + لحوم باردة',
                'داندى روستو لكل 50 فرد',
                'جولاش باللحمة — لازانيا باللحمة المفرومة',
                'دجاج مشوى بالأعشاب — كباب حلة',
                'أرز بالخلطة — خضروات سوتيه مشكلة',
                'حلويات شرقية وغربية',
                'تورتة العروسين خمسة أدوار',
            ], menuNotes: '' },
        ];
        const DEFAULT_WEDDING_EXTRAS = [
            { key: 'dj',    name: 'دي جي',        value: 2000, perGuest: false },
            { key: 'decor', name: 'كوشة + مدخل للقاعة + الدانس فلور + عارضة ليزر', value: 6000, perGuest: false },
            { key: 'rooms', name: 'غرفتان',       value: 6000, perGuest: false },
            { key: 'video', name: 'ميكسر مع 2 كاميرا HD + كاميرا كرين + شاشة عرض', value: 5200, perGuest: false },
            { key: 'chair', name: 'كرسي ديكور',   value: 30,   perGuest: true  },
        ];
        function fmtEGP(n) {
            const v = Math.round(Number(n) || 0);
            return v.toLocaleString('en-US') + ' جنيه';
        }

        // ─── وضع الزائر (مشاهدة فقط) ─────────────────────────────
        const GUEST_EMAIL = "__guest_viewer__";
        function isGuest() { return state.currentUserEmail === GUEST_EMAIL; }

        // ─── الأيام المنصرمة: مغلقة أمام إضافة حجوزات جديدة، ومقفلة أمام التعديل/الحذف/النقل إلا للأدمن ───
        function isPastDateStr(dateStr) {
            if (!dateStr) return false;
            const todayStr = new Date().toISOString().split('T')[0];
            return dateStr < todayStr;
        }

        function getWhatsAppLink(phone) {
            if (!phone) return '';
            let digits = String(phone).replace(/\D/g, '');
            if (!digits) return '';
            if (digits.startsWith('0')) digits = '20' + digits.slice(1);
            else if (!digits.startsWith('20')) digits = '20' + digits;
            return `https://wa.me/${digits}`;
        }

        // ─── أدوات مساعدة للتحويل بين مصفوفات state والعقد في Firebase ────
        function fbValToArray(val) {
            if (!val) return [];
            if (Array.isArray(val)) return val.filter(v => v !== null && v !== undefined);
            return Object.values(val);
        }

        // تعقيم أي نص مُدخَل من المستخدم (اسم شركة، ملاحظات، هاتف، اسم موظف...) قبل
        // إدراجه داخل innerHTML، لمنع حقن كود (Stored XSS) عبر حقول الحجز العادية
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // قراءة لقطة كاملة من البيانات (bookings/logs/users/updatedAt) — بديل GET القديم على CLOUD_URL
        async function fetchCloudSnapshot() {
            const [bSnap, lSnap, uSnap, mSnap] = await Promise.all([
                db.ref('bookings').once('value'),
                db.ref('logs').once('value'),
                db.ref('users').once('value'),
                db.ref('meta/updatedAt').once('value')
            ]);
            return {
                bookings: fbValToArray(bSnap.val()),
                logs: fbValToArray(lSnap.val()),
                users: fbValToArray(uSnap.val()),
                updatedAt: mSnap.val() || null
            };
        }

        // كتابة لقطة كاملة: نستبدل عقدة bookings بالكامل بمصفوفة finalBookings
        // المحسوبة محليًا (وهي أصلًا نتيجة دمج نسخة السيرفر + تعديلاتنا المحلية).
        // ── ليه رجّعنا لل full overwrite بدل التحديث الجزئي (update بمسار مستقل لكل حجز)؟ ──
        // التحديث الجزئي كان بيكتب فقط الحجوزات الـ dirty ويحذف فقط اللي في pendingDeletions،
        // فلو لأي سبب (نسخة قديمة من التطبيق، إرسال مزدوج، أو أي علة توقيت) حجز اتشال محليًا
        // من غير ما يوصل الـ id بتاعه فعليًا لـ pendingDeletions وقت الرفع، كان بيفضل عالق في
        // فايربيز للأبد — مفيش حاجة بتقوله يمسحه — وبيرجع يظهر كحجز مكرر في كل مزامنة تالية.
        // الكتابة الكاملة هنا ذاتية الإصلاح: أي حجز مش موجود في finalBookings بيتشال تلقائيًا
        // من فايربيز لأن set() بيستبدل العقدة بالكامل، فمفيش نسخ قديمة ممكن تفضل عالقة.
        async function pushCloudSnapshot(finalBookings, finalLogs, usersForCloud) {
            const now = new Date().toISOString();
            await Promise.all([
                db.ref('bookings').set(finalBookings),
                db.ref('logs').set(finalLogs),
                db.ref('users').set(usersForCloud),
                db.ref('meta/updatedAt').set(now)
            ]);
            _lastKnownUpdatedAt = now; // تسجيل فوري لتفادي إعادة مزامنة ذاتية عند وصول حدث المستمع اللحظي
            return now;
        }

        // ─── تسجيل الحجوزات المحذوفة في عقدة منفصلة (بديل شيت الحذف المنفصل) ────
        function logDeletedBookingToCloud(booking, deleteType) {
            const hallName = (HALLS.find(h => h.id === booking.hallId) || {}).name || booking.hallName || '';

            const payload = {
                bookingId:   booking.id,
                groupId:     booking.groupId || '',
                deleteType:  deleteType, // 'يوم واحد' أو 'الحجز بالكامل'
                companyName: booking.companyName || '',
                phone:       booking.phone || '',
                hallName:    hallName,
                startDate:   booking.startDate || '',
                endDate:     booking.endDate || '',
                startTime:   booking.startTime || '',
                endTime:     booking.endTime || '',
                notes:       booking.notes || '',
                deletedBy:   state.currentUserEmail || '',
                deletedAt:   new Date().toISOString()
            };

            try {
                db.ref('deletedBookings').push(payload).catch(() => {});
            } catch (e) {
                // نتجاهل أي خطأ هنا حتى لا يعطّل عملية الحذف الأساسية
            }
        }

        // ─── Default Employee Name Based on Logged-in User ────────────────
        const DEFAULT_EMPLOYEE_BY_EMAIL = {
            "salama.m@gmail.com": "محمد عبد السلام",
            "rihan@gmail.com": "علاء شحاته"
        };
        function getDefaultEmployeeName() {
            return DEFAULT_EMPLOYEE_BY_EMAIL[(state.currentUserEmail || '').toLowerCase()] || '';
        }

        // Colors for JS Injection
        const COLOR_RED = '#6E1418';
        const COLOR_GOLD = '#A88A45';

        const HALLS = [
            { id: 'yacht', name: 'قاعة اليخت', icon: 'ship', color: 'bg-blue-50 text-blue-700', border: 'border-blue-400' },
            { id: 'italian', name: 'القاعة الإيطالية', icon: 'armchair', color: 'bg-red-50 text-red-700', border: 'border-red-400' },
            { id: 'greenhouse', name: 'الجرين هاوس', icon: 'flower-2', color: 'bg-green-50 text-green-700', border: 'border-green-400' },
            { id: 'bar', name: 'البار', icon: 'glass-water', color: 'bg-purple-50 text-purple-700', border: 'border-purple-400' },
            { id: 'pool', name: 'حمام السباحة', icon: 'waves', color: 'bg-cyan-50 text-cyan-700', border: 'border-cyan-400' },
        ];

        let state = {
            currentUserEmail: localStorage.getItem('hotel_app_email') || '',
            isLoggedIn: !!localStorage.getItem('hotel_app_email'),
            users: JSON.parse(localStorage.getItem('hotel_users_db')) || [],
            view: 'dashboard',
            activeTab: 'calendar',
            selectedHall: null,
            bookings: JSON.parse(localStorage.getItem('hotel_bookings_local')) || [],
            activityLogs: JSON.parse(localStorage.getItem('hotel_logs_local')) || [],
            pendingDeletions: JSON.parse(localStorage.getItem('hotel_deleted_ids')) || [],
            pendingDeletedUsers: JSON.parse(localStorage.getItem('hotel_deleted_users')) || [],
            dirtyUserEmails: JSON.parse(localStorage.getItem('hotel_dirty_users')) || [],
            notifications: JSON.parse(localStorage.getItem('hotel_notifications')) || [], 
            weddingSettings: JSON.parse(localStorage.getItem('hotel_wedding_settings')) || {
                packages: DEFAULT_WEDDING_PACKAGES.map(p => ({ ...p })),
                extras:   DEFAULT_WEDDING_EXTRAS.map(e => ({ ...e }))
            },
            currentMonth: new Date().getMonth(),
            currentYear: new Date().getFullYear(),
            editingBookingId: null,
            isSyncing: false,
            // --- Race condition fix ---
            // يُزاد بمقدار 1 في كل عملية حذف/تعديل قبل أي fetch
            // الـ syncToCloud يتحقق منه بعد الـ fetch: لو تغيّر = فيه عملية أحدث → يتوقف
            _opsVersion: 0,
            // طابور: لو جاء طلب مزامنة وفيه واحدة جارية، ننتظر ثم نُعيد
            _syncPending: false
        };

        // --- Core Functions ---
        window.onload = () => {
            init();
            hideRestaSplashScreen();
            // تم استبدال الفحص الدوري (setInterval كل SYNC_INTERVAL) بالاشتراك اللحظي
            // على meta/updatedAt — يتم تفعيله داخل init() / performLogin() عبر setupRealtimeSync()
            document.addEventListener('click', function(e) {
                const moreContainer = document.getElementById('moreMenuContainer');
                const moreDd = document.getElementById('moreMenuDropdown');
                if (moreDd && moreContainer && !moreContainer.contains(e.target)) {
                    moreDd.classList.add('hidden');
                }
                const gamesContainer = document.getElementById('gamesDropdownContainer');
                const gamesDd = document.getElementById('gamesDropdown');
                if (gamesDd && gamesContainer && !gamesContainer.contains(e.target)) {
                    gamesDd.classList.add('hidden');
                }
                // Close any open attachment dropdowns when clicking outside
                // both the dropdown itself (now living under <body>) and its
                // trigger button.
                document.querySelectorAll('.attachment-dropdown:not(.hidden)').forEach(dd => {
                    const btn = dd._ownerBtn;
                    if (!dd.contains(e.target) && !(btn && btn.contains(e.target))) {
                        dd.classList.add('hidden');
                    }
                });
            });

            // تمرير تلقائي للصفحة لأعلى/لأسفل أثناء سحب حجز (يفيد خصوصاً على الموبايل
            // حيث لا يظهر التقويم كاملاً على الشاشة أثناء السحب)
            document.addEventListener('dragover', handleGlobalDragAutoScroll);
            document.addEventListener('touchmove', handleGlobalTouchAutoScroll, { passive: true });
            document.addEventListener('dragend', stopDragAutoScroll);
            document.addEventListener('drop', stopDragAutoScroll);
        };

        // إخفاء شاشة الترحيب بعد جاهزية التطبيق مع ضمان ظهورها لفترة كافية لرؤية الحركة
        function hideRestaSplashScreen() {
            const MIN_SPLASH_MS = 1600;
            const splashStart = window.__restaSplashStart || Date.now();
            const elapsed = Date.now() - splashStart;
            const remaining = Math.max(0, MIN_SPLASH_MS - elapsed);
            setTimeout(() => {
                const splash = document.getElementById('restaSplashScreen');
                if (splash) {
                    splash.classList.add('splash-hide');
                    setTimeout(() => splash.remove(), 800);
                }
            }, remaining);
        }

        function init() {
            if(typeof lucide!=="undefined") lucide.createIcons();
            updateLoginScreenBiometricButton();
            
            // Ensure Admin Exists
            const ADMIN_PASS = 'Hamada@1968';
            const adminIndex = state.users.findIndex(u => u.email === ADMIN_EMAIL);
            if (adminIndex !== -1) {
                if (state.users[adminIndex].password !== ADMIN_PASS) {
                    state.users[adminIndex].password = ADMIN_PASS;
                    saveUsers();
                }
            } else {
                state.users.push({ email: ADMIN_EMAIL, password: ADMIN_PASS, createdAt: new Date().toISOString() });
                saveUsers();
                markUserDirty(ADMIN_EMAIL);
            }

            // تنظيف لمرة واحدة: حذف جميع الحسابات والإبقاء فقط على الحسابات المسموح بها
            if (!localStorage.getItem('hotel_users_cleanup_v1')) {
                const ALLOWED_EMAILS = ['salama.m@gmail.com', 'rihan@gmail.com', 'marwa@gmail.com'];
                const removedEmails = state.users
                    .filter(u => !ALLOWED_EMAILS.includes((u.email || '').toLowerCase()))
                    .map(u => u.email);
                if (removedEmails.length > 0) {
                    state.users = state.users.filter(u => ALLOWED_EMAILS.includes((u.email || '').toLowerCase()));
                    removedEmails.forEach(email => {
                        if (!state.pendingDeletedUsers.includes(email)) {
                            state.pendingDeletedUsers.push(email);
                        }
                    });
                    state._opsVersion++;
                    localStorage.setItem('hotel_deleted_users', JSON.stringify(state.pendingDeletedUsers));
                    saveUsers();
                    syncToCloud();
                }
                localStorage.setItem('hotel_users_cleanup_v1', '1');
            }

            // Migrate legacy bookings: assign groupId from id prefix if missing
            let migrated = false;
            state.bookings.forEach(b => {
                if (!b.groupId) {
                    b.groupId = b.id.toString().split('_d')[0];
                    migrated = true;
                }
            });
            if (migrated) localStorage.setItem('hotel_bookings_local', JSON.stringify(state.bookings));

            if (state.isLoggedIn) {
                attemptAutoUnlock();
            }

            setupWeddingSettingsListener();
        }

        // ─── إعدادات باقات الأفراح والخطوبة (مشتركة بين جميع المستخدمين) ───
        function setupWeddingSettingsListener() {
            if (!CLOUD_ENABLED) return;
            db.ref('weddingSettings').on('value', (snap) => {
                const val = snap.val();
                if (val && Array.isArray(val.packages) && Array.isArray(val.extras)) {
                    state.weddingSettings = val;
                    localStorage.setItem('hotel_wedding_settings', JSON.stringify(val));
                    if (document.getElementById('weddingPackageSelect')) populateWeddingPackageSelect();
                    const settingsModal = document.getElementById('weddingSettingsModal');
                    if (settingsModal && !settingsModal.classList.contains('hidden')) renderWeddingSettingsModal();
                    const qc = document.getElementById('quickCalcModal');
                    if (qc && !qc.classList.contains('hidden')) renderQuickCalcModal();
                }
            });
        }

        async function saveWeddingSettingsToCloud() {
            if (state.currentUserEmail !== ADMIN_EMAIL) {
                showToast('عذراً، تعديل أسعار باقات الأفراح متاح للأدمن فقط.', 'error');
                return;
            }
            try {
                await db.ref('weddingSettings').set(state.weddingSettings);
                localStorage.setItem('hotel_wedding_settings', JSON.stringify(state.weddingSettings));
                showToast('✅ تم حفظ إعدادات باقات الأفراح بنجاح', 'success');
            } catch (err) {
                showToast('حدث خطأ أثناء حفظ الإعدادات: ' + err.message, 'error');
            }
        }

        function saveUsers() {
            localStorage.setItem('hotel_users_db', JSON.stringify(state.users));
        }

        // يعلّم مستخدم معيّن كـ"معدَّل محليًا" (إضافة/تغيير باسورد) عشان يتبعت فعليًا للسحابة
        // في المزامنة الجاية، بدل الاعتماد على استنتاج الفرق بين القوائم
        function markUserDirty(email) {
            if (!state.dirtyUserEmails.includes(email)) {
                state.dirtyUserEmails.push(email);
            }
            state._opsVersion++;
            localStorage.setItem('hotel_dirty_users', JSON.stringify(state.dirtyUserEmails));
        }

        function showSync(text = "جاري المزامنة...", isError = false) {
            const status = document.getElementById('sync-status');
            const dot = document.getElementById('sync-dot');
            const label = document.getElementById('sync-text');
            status.style.display = 'flex';
            label.innerText = text;
            dot.className = isError ? "w-3 h-3 bg-red-500 rounded-full" : `w-3 h-3 rounded-full animate-pulse-soft`;
            dot.style.backgroundColor = isError ? '#ef4444' : COLOR_GOLD;
            if(!isError) setTimeout(() => status.style.display = 'none', 3000);
        }

        async function syncToCloud(isSilent = false) {
            if (!CLOUD_ENABLED) return;

            // لو في مزامنة جارية، ضع علامة "ينتظر" واخرج
            if (state.isSyncing) {
                state._syncPending = true;
                return;
            }

            state.isSyncing = true;
            state._syncPending = false;
            if (!isSilent) showSync("جاري المزامنة مع السحابة...");

            // سجّل نسخة العمليات الحالية قبل أي fetch
            const opsVersionAtStart = state._opsVersion;

            try {
                const dirtyBookings     = state.bookings.filter(b => b._isDirty);
                const pendingDels       = [...state.pendingDeletions];
                const pendingDelUsers   = [...state.pendingDeletedUsers];
                const hasPendingChanges = dirtyBookings.length > 0 || pendingDels.length > 0 || pendingDelUsers.length > 0;

                const serverData = await fetchCloudSnapshot();

                // *** الفحص الأساسي لحل مشكلة الـ race condition ***
                // لو تغيّرت نسخة العمليات أثناء القراءة (يعني جاء حذف/تعديل جديد)
                // نوقف هذه الدورة ونبدأ دورة جديدة بالبيانات المحدّثة
                if (state._opsVersion !== opsVersionAtStart) {
                    state.isSyncing = false;
                    state._syncPending = true;
                    setTimeout(() => syncToCloud(isSilent), 500);
                    return;
                }

                const serverBookings = serverData.bookings || [];
                const serverLogs     = serverData.logs     || [];
                const serverUsers    = serverData.users    || [];

                // ── حماية: لو حساب المستخدم الحالي اتحذف من مكان تاني (السيرفر ما عادش فيه إيميله) ──
                // نعمل له تسجيل خروج فوري بدل ما نسيبه شغال بحساب محذوف، ونمنع أي رفع بيانات لحسابه
                const serverEmailsSetCheck = new Set(serverUsers.map(su => su.email));
                if (state.currentUserEmail && state.currentUserEmail !== GUEST_EMAIL &&
                    state.currentUserEmail !== ADMIN_EMAIL && !serverEmailsSetCheck.has(state.currentUserEmail)) {
                    state.isSyncing = false;
                    showToast('تم حذف حسابك من قبل المدير. سيتم تسجيل خروجك.', 'error');
                    setTimeout(logout, 1000);
                    return;
                }

                // مستخدمون تم تعديلهم محليًا (إضافة جديدة أو تغيير باسورد) عبر action صريح
                // بنعتمد على قائمة صريحة (dirtyUserEmails) بدل استنتاج "الفرق" بين القوائم،
                // عشان أي جهاز (حتى جهاز الأدمن نفسه لو فاتح من كذا متصفح) ولسه شايل نسخة محلية
                // قديمة، ميرجّعش يبعت مستخدمين اتحذفوا من جهاز تاني للسحابة تاني من غير قصد
                const pendingUserChanges = [...(state.dirtyUserEmails || [])];
                const hasPendingUserChanges = pendingUserChanges.length > 0;
                const shouldPushUsers = hasPendingChanges || hasPendingUserChanges;

                let finalBookings;
                let usersForCloud;

                if (shouldPushUsers) {
                    const bookingsMap = new Map(serverBookings.map(b => [String(b.id), b]));
                    dirtyBookings.forEach(b => {
                        const clean = { ...b };
                        delete clean._isDirty;
                        bookingsMap.set(String(b.id), clean);
                    });
                    pendingDels.forEach(id => bookingsMap.delete(String(id)));
                    finalBookings = Array.from(bookingsMap.values());

                    // ── بناء قائمة المستخدمين اللي هتتبعت للسحابة ──
                    // الأساس هو قائمة السحابة نفسها (المصدر الموثوق)، وفوقها بس بنطبّق:
                    // 1. حذف المستخدمين اللي في pendingDelUsers
                    // 2. تحديث/إضافة المستخدمين اللي فعليًا اتغيّروا محليًا (pendingUserChanges)
                    // كده أي مستخدم تاني موجود محليًا بس ملوش تغيير صريح، مش هيتبعت تاني للسحابة
                    const deletedUsersSet = new Set(pendingDelUsers);
                    const usersMap = new Map(serverUsers.map(su => [su.email, su]));
                    deletedUsersSet.forEach(email => usersMap.delete(email));
                    pendingUserChanges.forEach(email => {
                        if (deletedUsersSet.has(email)) return;
                        const localUser = state.users.find(u => u.email === email);
                        if (localUser) usersMap.set(email, localUser);
                    });
                    usersForCloud = Array.from(usersMap.values());

                    await pushCloudSnapshot(
                        finalBookings,
                        mergeLogs(state.activityLogs, serverLogs),
                        usersForCloud
                    );

                    // فحص ثالث بعد الكتابة — لو حصل تغيير أثناء الكتابة، لا تُحدّث state
                    if (state._opsVersion !== opsVersionAtStart) {
                        state.isSyncing = false;
                        state._syncPending = true;
                        setTimeout(() => syncToCloud(isSilent), 800);
                        return;
                    }

                } else {
                    finalBookings = serverBookings;
                }

                const localCleanCount = state.bookings.filter(b => !b._isDirty).length;
                if (finalBookings.length === 0 && localCleanCount > 0 && pendingDels.length === 0) {
                    throw new Error('السيرفر رجّع بيانات فارغة بشكل غير متوقع — تم إلغاء التحديث للحفاظ على البيانات');
                }

                const prevIds   = new Set(state.bookings.filter(b => !b._isDirty).map(b => String(b.id)));
                const newIds    = new Set(finalBookings.map(b => String(b.id)));
                const pendingDelSet = new Set(pendingDels.map(String));

                finalBookings.forEach(b => {
                    if (!prevIds.has(String(b.id)) && !dirtyBookings.find(d => String(d.id) === String(b.id))) {
                        let _addedByEmail = b.createdBy || '';
                        if (!_addedByEmail) {
                            // لو الحجز لأي سبب من غير createdBy، ندور على أقرب سجل "إضافة/تعديل" مطابق بنفس رقم الحجز أو التاريخ
                            const _addLogsForCompany = serverLogs
                                .filter(l => (l.type === 'إضافة' || l.type === 'تعديل') && l.company === b.companyName)
                                .sort((x, y) => new Date(y.isoTimestamp || 0) - new Date(x.isoTimestamp || 0));
                            const _addLogMatch = _addLogsForCompany.find(l => l.bookingId && l.bookingId === b.id)
                                || _addLogsForCompany.find(l => l.startDate && l.startDate === b.startDate)
                                || _addLogsForCompany[0];
                            _addedByEmail = (_addLogMatch && _addLogMatch.user) || '';
                        }
                        const _addedByName = (_addedByEmail.split('@')[0]) || 'مستخدم آخر';
                        addNotification(`حجز جديد من ${_addedByName}: ${b.companyName} - بتاريخ ${b.startDate ? b.startDate.split('-').reverse().join('/') : ''}`, 'add', b.startDate);
                        showToast(`حجز جديد من ${_addedByName} - ${b.companyName} - بتاريخ ${b.startDate ? b.startDate.split('-').reverse().join('/') : ''}`, 'success', b.startDate);
                    }
                });
                state.bookings.filter(b => !b._isDirty).forEach(b => {
                    if (!newIds.has(String(b.id)) && !pendingDelSet.has(String(b.id))) {
                        const _delLogsForCompany = serverLogs
                            .filter(l => l.type === 'حذف' && l.company === b.companyName)
                            .sort((x, y) => new Date(y.isoTimestamp || 0) - new Date(x.isoTimestamp || 0));
                        // نفضّل تطابق دقيق بمعرّف الحجز أو تاريخه، وبس لو مفيش تطابق دقيق نرجع لأحدث سجل بنفس اسم الشركة (سجلات قديمة قبل إضافة الحقول دي)
                        const _delLogMatch = _delLogsForCompany.find(l => l.bookingId && l.bookingId === b.id)
                            || _delLogsForCompany.find(l => l.startDate && l.startDate === b.startDate)
                            || _delLogsForCompany[0];
                        const _deletedByName = (((_delLogMatch && _delLogMatch.user) || '').split('@')[0]) || 'مستخدم آخر';
                        addNotification(`تم حذف حجز بواسطة ${_deletedByName}: ${b.companyName} - بتاريخ ${b.startDate ? b.startDate.split('-').reverse().join('/') : ''}`, 'delete', b.startDate);
                        showToast(`تم حذف حجز بواسطة ${_deletedByName} - ${b.companyName} - بتاريخ ${b.startDate ? b.startDate.split('-').reverse().join('/') : ''}`, 'error');
                    }
                });

                const finalLogs  = mergeLogs(state.activityLogs, serverLogs);
                // ── بناء القائمة النهائية للمستخدمين بعد المزامنة ──
                // السحابة هي المصدر الموثوق دايمًا. لو كنا بعتنا تعديلات (shouldPushUsers)
                // فالقائمة اللي اتبعتت (usersForCloud) هي الصح، وإلا فقائمة السحابة نفسها كما هي.
                // كده أي نسخة محلية قديمة (فيها مستخدم متحذف من جهاز تاني) بتتصفّى تلقائيًا بعد كل مزامنة
                const finalUsers = shouldPushUsers ? usersForCloud : serverUsers;

                state.bookings          = finalBookings;   
                state.pendingDeletions  = [];
                state.pendingDeletedUsers = [];
                state.dirtyUserEmails    = [];
                state.activityLogs      = finalLogs;
                state.users             = finalUsers;

                localStorage.setItem('hotel_deleted_ids', JSON.stringify([]));
                localStorage.setItem('hotel_deleted_users', JSON.stringify([]));
                localStorage.setItem('hotel_dirty_users', JSON.stringify([]));
                saveLocalStateOnly();

                if (!(state.view === 'hall_detail' && state.activeTab === 'form')) {
                    render();
                    const modal = document.getElementById('detailsModal');
                    if (!modal.classList.contains('hidden')) {
                        const dateTitle = document.getElementById('modalDateTitle').dataset.date;
                        if (dateTitle) showDayDetails(dateTitle);
                    }
                    const userModal = document.getElementById('usersModal');
                    if (!userModal.classList.contains('hidden')) renderUsersTable();
                }

                if (!isSilent) showSync("تمت المزامنة بنجاح ✓");

            } catch (e) {
                console.error("Sync Error:", e);
                if (!isSilent) showSync("فشل المزامنة: " + e.message, true);
            }

            state.isSyncing = false;
            if (!isSilent) setTimeout(() => document.getElementById('sync-status').style.display = 'none', 3000);

            // لو في طلب مزامنة معلّق، شغّله الآن
            if (state._syncPending) {
                state._syncPending = false;
                setTimeout(() => syncToCloud(true), 300);
            }
        }

        function mergeLogs(localLogs, serverLogs) {
            return [...localLogs, ...serverLogs]
                .filter((v, i, a) => a.findIndex(t => t.time === v.time && t.date === v.date && t.company === v.company) === i)
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, 100);
        }

        async function loadFromCloud(isSilent = false) {
            await syncToCloud(isSilent);
        }

        // ─── الاشتراك اللحظي في تحديثات السحابة ─────────────────────────
        // يحل محل "تحميل مرة واحدة + فحص دوري كل SYNC_INTERVAL": بدل السؤال عن
        // وجود تحديث كل عدة ثوانٍ، نستمع مباشرة لتغيّر meta/updatedAt في Firebase،
        // فتتم المزامنة فوراً عند أي تغيير حقيقي فقط (من نفس المستخدم على جهاز آخر
        // أو من مستخدم آخر)، مع تجاهل الأصداء الناتجة عن كتابتنا نحن أنفسنا.
        function setupRealtimeSync() {
            if (!CLOUD_ENABLED) return;
            // نشيل أي اشتراك سابق أولاً (idempotent) — يمنع تراكم أكثر من listener
            // على نفس المسار لو الدالة دي اتنادت أكتر من مرة بدون teardown بينهم
            // (مثال: قفل وفتح التطبيق بالبصمة عدة مرات في نفس الجلسة)
            teardownRealtimeSync();
            db.ref('meta/updatedAt').on('value', (snap) => {
                const newVal = snap.val();
                if (newVal === _lastKnownUpdatedAt) return; // نفس القيمة (غالباً صدى كتابتنا) — تجاهل
                _lastKnownUpdatedAt = newVal;
                if (state.isSyncing) {
                    state._syncPending = true;
                    return;
                }
                syncToCloud(true);
            });
        }

        function teardownRealtimeSync() {
            db.ref('meta/updatedAt').off('value');
        }

        function saveLocal() {
            // ارفع العداد أولاً — يُبطل أي دورة مزامنة جارية كانت بدأت قبل هذه العملية
            state._opsVersion++;
            localStorage.setItem('hotel_bookings_local', JSON.stringify(state.bookings));
            localStorage.setItem('hotel_logs_local', JSON.stringify(state.activityLogs));
            localStorage.setItem('hotel_deleted_ids', JSON.stringify(state.pendingDeletions));
            syncToCloud();
        }

        function saveLocalStateOnly() {
            localStorage.setItem('hotel_bookings_local', JSON.stringify(state.bookings));
            localStorage.setItem('hotel_logs_local', JSON.stringify(state.activityLogs));
            localStorage.setItem('hotel_users_db', JSON.stringify(state.users));
            localStorage.setItem('hotel_notifications', JSON.stringify(state.notifications));
        }

        // --- Notification System ---
        function addNotification(text, type, bookingDate) {
            const notif = {
                id: Date.now() + Math.random(),
                text: text,
                type: type, // 'add' or 'delete'
                time: new Date().toLocaleTimeString('ar-EG'),
                date: new Date().toLocaleDateString('ar-EG'),
                bookingDate: bookingDate || null
            };
            state.notifications.unshift(notif);
            if(state.notifications.length > 50) state.notifications.pop();
            localStorage.setItem('hotel_notifications', JSON.stringify(state.notifications));
            renderHeader(); // Refresh header to show badge
        }

        function showToast(message, type, bookingDate) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            
            const bgClass = type === 'error' ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200';
            const textClass = type === 'error' ? 'text-red-800' : 'text-emerald-800';
            const iconBg = type === 'error' ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600';
            const progressClass = type === 'error' ? 'bg-red-400' : 'bg-emerald-400';
            const icon = type === 'error' ? 'trash-2' : 'check-circle';

            const clickableStyles = bookingDate
                ? 'cursor-pointer hover:shadow-2xl hover:scale-[1.01] active:scale-[0.99]'
                : '';
            const clickHint = bookingDate
                ? `<span class="text-xs font-medium opacity-60 mt-0.5 block">اضغط لعرض التفاصيل</span>`
                : '';

            toast.className = `pointer-events-auto relative overflow-hidden p-4 pb-[18px] rounded-2xl border shadow-xl flex items-center gap-4 animate-slide-up transition-transform duration-200 ${bgClass} ${clickableStyles}`;
            toast.innerHTML = `
                <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center shrink-0 toast-icon-pop">
                    <i data-lucide="${icon}" class="w-5 h-5"></i>
                </div>
                <div class="flex-1">
                    <p class="text-sm font-bold ${textClass}">${escapeHtml(message)}</p>
                    ${clickHint}
                </div>
                <button type="button" class="toast-close-btn text-slate-400 hover:text-slate-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors shrink-0">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
                <div class="absolute bottom-0 right-0 left-0 h-[3px] bg-black/10">
                    <div class="toast-progress-bar h-full ${progressClass}"></div>
                </div>
            `;

            if (bookingDate) {
                toast.addEventListener('click', function() {
                    dismissToast(toast);
                    showDayDetails(bookingDate);
                });
            }

            toast.querySelector('.toast-close-btn').addEventListener('click', function(e) {
                e.stopPropagation();
                dismissToast(toast);
            });
            
            container.appendChild(toast);
            if(typeof lucide!=="undefined") lucide.createIcons(); // Ensure icons render
            
            // إخفاء تلقائي بعد 5 ثوانٍ (شريط التقدم أعلاه يتزامن مع نفس المدة)
            toast._toastTimer = setTimeout(() => dismissToast(toast), 5000);
        }

        // إخفاء التوست بحركة fade-out ناعمة بدل الاختفاء المفاجئ
        function dismissToast(toast) {
            if (!toast || toast.dataset.dismissing === '1') return;
            toast.dataset.dismissing = '1';
            if (toast._toastTimer) clearTimeout(toast._toastTimer);
            toast.classList.remove('animate-slide-up');
            toast.classList.add('toast-fade-out');
            const remove = () => { if (toast && toast.parentElement) toast.remove(); };
            toast.addEventListener('animationend', remove, { once: true });
            setTimeout(remove, 400); // شبكة أمان في حال لم يُطلق animationend
        }

        function toggleNotificationsModal() {
            if (isGuest()) return;
            const modal = document.getElementById('notificationsModal');
            const list = document.getElementById('notificationsList');
            
            if(modal.classList.contains('hidden')) {
                if (state.notifications.length === 0) {
                    list.innerHTML = `
                        <div class="flex flex-col items-center justify-center h-64 text-slate-400">
                            <div class="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                                <i data-lucide="bell-off" class="w-8 h-8 text-slate-300"></i>
                            </div>
                            <p class="text-sm font-bold">لا توجد إشعارات جديدة</p>
                            <p class="text-xs mt-1 text-slate-400">سيتم عرض تحديثات النظام هنا</p>
                        </div>
                    `;
                } else {
                    list.innerHTML = state.notifications.map(n => {
                        const isClickable = !!n.bookingDate;
                        const clickableClass = isClickable ? 'cursor-pointer hover:bg-amber-50 active:bg-amber-100' : '';
                        const clickAttr = isClickable ? `onclick="document.getElementById('notificationsModal').classList.add('hidden'); showDayDetails('${n.bookingDate}')"` : '';
                        const hint = isClickable ? `<span class="text-[10px] text-[#A88A45] font-bold mt-1 flex items-center gap-1"><i data-lucide="eye" class="w-3 h-3"></i> اضغط لعرض تفاصيل الحجز</span>` : '';
                        return `
                        <div class="p-4 border-b border-slate-100 hover:bg-white transition-colors ${clickableClass}" ${clickAttr}>
                            <div class="flex items-start gap-4">
                                <div class="mt-1 w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${n.type === 'delete' ? 'bg-red-500 shadow-red-200' : 'bg-emerald-500 shadow-emerald-200'}"></div>
                                <div class="flex-1 min-w-0">
                                    <p class="text-sm text-slate-700 font-bold leading-relaxed">${escapeHtml(n.text)}</p>
                                    <p class="text-[11px] text-slate-400 mt-2 flex items-center gap-1 font-medium">
                                        <i data-lucide="clock" class="w-3 h-3"></i> ${n.date} - ${n.time}
                                    </p>
                                    ${hint}
                                </div>
                                ${isClickable ? `<div class="shrink-0 w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-[#A88A45]"><i data-lucide="chevron-left" class="w-4 h-4"></i></div>` : ''}
                            </div>
                        </div>
                    `}).join('');
                }
                if(typeof lucide!=="undefined") lucide.createIcons();
                modal.classList.remove('hidden');
            } else {
                modal.classList.add('hidden');
            }
        }

        function clearNotifications() {
            if(confirm("هل أنت متأكد من مسح سجل الإشعارات بالكامل؟")) {
                state.notifications = [];
                localStorage.setItem('hotel_notifications', JSON.stringify([]));
                toggleNotificationsModal(); 
                renderHeader();
            }
        }

        // --- Export to Excel ---
        function exportToExcel() {
            const bookings = [...state.bookings].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

            const wsData = [
                ["الرقم المرجعي", "اسم الشركة/الجهة", "القاعة", "من تاريخ", "إلى تاريخ",
                 "من وقت", "إلى وقت", "رقم الهاتف", "الموظف المسؤول",
                 "ملاحظات", "روابط المرفقات", "تم الإنشاء بواسطة", "تاريخ الإنشاء"],
                ...bookings.map(b => [
                    b.id        || '',
                    b.companyName || '',
                    HALLS.find(h => h.id === b.hallId)?.name || b.hallId || '',
                    b.startDate || '',
                    b.endDate   || '',
                    b.startTime || '',
                    b.endTime   || '',
                    b.phone     || '',
                    b.employee  || '',
                    (b.notes    || '').replace(/\n/g, ' '),
                    getBookingLinks(b).join(' | '),
                    b.createdBy || '',
                    b.createdAt ? b.createdAt.split('T')[0] : ''
                ])
            ];

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(wsData);

            ws['!cols'] = [
                {wch:30},{wch:25},{wch:18},{wch:13},{wch:13},
                {wch:10},{wch:10},{wch:15},{wch:18},
                {wch:30},{wch:30},{wch:25},{wch:13}
            ];

            XLSX.utils.book_append_sheet(wb, ws, 'الحجوزات');
            XLSX.writeFile(wb, 'Resta_Bookings_' + new Date().toISOString().slice(0,10) + '.xlsx');
        }

        // --- Auth Functions ---
        function handleLogin(e) {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value.trim().toLowerCase();
            const password = document.getElementById('loginPassword').value;

            if (!email || !password) return;

            const existingUser = state.users.find(u => u.email === email);

            if (existingUser) {
                if (existingUser.password === password) {
                    performLogin(email);
                } else {
                    alert('كلمة المرور غير صحيحة!');
                }
            } else {
                alert('هذا البريد الإلكتروني غير مسجل في النظام. يرجى التواصل مع المدير لإنشاء حسابك.');
            }
        }

        function performLogin(email) {
            state.currentUserEmail = email;
            state.isLoggedIn = true;
            localStorage.setItem('hotel_app_email', email);
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            render();
            if (CLOUD_ENABLED) setupRealtimeSync();
            offerBiometricSetup(email);
        }

        function loginAsGuest() {
            performLogin(GUEST_EMAIL);
        }

        function logout() {
            if (CLOUD_ENABLED) teardownRealtimeSync();
            state.currentUserEmail = '';
            state.isLoggedIn = false;
            localStorage.removeItem('hotel_app_email');
            hideBiometricLockScreen();
            document.getElementById('loginModal').style.display = 'flex';
            document.getElementById('app').style.display = 'none';
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
            updateLoginScreenBiometricButton();
        }

        // ===================== Auto Logout (خروج تلقائي بعد فترة عدم نشاط) =====================
        // إضافة مستقلة لا تعدّل أي منطق أو تصميم موجود: بتسجّل خروج المستخدم تلقائيًا
        // لو التطبيق فضل بدون أي تفاعل (لمس/ضغط/كتابة) أو بدون ظهور على الشاشة
        // لمدة أطول من AUTO_LOGOUT_MINUTES. تعمل نفس الطريقة سواء اتفتح من متصفح
        // عادي أو من داخل تطبيق الأندرويد (WebView).
        const AUTO_LOGOUT_MINUTES = 3; // غيّر الرقم ده لتعديل مدة الخمول المسموحة
        const AUTO_LOGOUT_MS = AUTO_LOGOUT_MINUTES * 60 * 1000;
        const LAST_ACTIVITY_KEY = 'hotel_last_activity_ts';
        let _lastActivityWriteAt = 0;

        function recordActivityTimestamp() {
            if (!state.isLoggedIn) return;
            const now = Date.now();
            // لتقليل عدد الكتابات على localStorage وقت الحركة المستمرة (mousemove/scroll)
            if (now - _lastActivityWriteAt < 5000) return;
            _lastActivityWriteAt = now;
            localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
        }

        function checkAutoLogout() {
            if (!state.isLoggedIn) return;
            const last = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10);
            if (last && (Date.now() - last) > AUTO_LOGOUT_MS) {
                logout();
            } else {
                recordActivityTimestamp();
            }
        }

        ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(function(evt) {
            document.addEventListener(evt, recordActivityTimestamp, { passive: true });
        });

        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                // التطبيق ظهر تاني (سواء اترجع من الخلفية في الأندرويد أو رجّع تاب في المتصفح)
                checkAutoLogout();
            } else {
                // هيتم اعتبار وقت الاختفاء كآخر نشاط، عشان لو رجع بعد وقت طويل يتسجل خروجه
                recordActivityTimestamp();
            }
        });

        window.addEventListener('DOMContentLoaded', function() {
            recordActivityTimestamp();
        });

        setInterval(checkAutoLogout, 60 * 1000);
        // ===================== End Auto Logout =====================

        // ===================== Biometric (Fingerprint / Face ID) Login =====================
        // نظام دخول بالبصمة على مستوى الجهاز: بعد أول تسجيل دخول ناجح بكلمة المرور،
        // نعرض على المستخدم تفعيل البصمة. لو وافق، نسجل بيانات اعتماد محليًا على هذا
        // الجهاز فقط. في المرات القادمة، بدل عرض شاشة الدخول العادية مباشرة نطلب تحقق
        // بالبصمة، ولو نجح نفتح التطبيق تلقائيًا بدون أي نقر على زر الدخول.
        // فيه مساران للتحقق:
        //  1) جسر تطبيق أندرويد الأصلي (WebView) عبر window.Android.authenticateBiometric()
        //     - يُستخدم تلقائيًا لو التطبيق شغال جوه تطبيق أندرويد يوفر الجسر ده.
        //  2) WebAuthn (Platform Authenticator) للمتصفحات العادية على الموبايل/الديسكتوب.
        // ملحوظة: الاتنين تحقق محلي على مستوى الجهاز وليس تحقق مركزي عبر سيرفر، وهو
        // مناسب تمامًا لطبيعة النظام الحالي (لا يوجد باك إند مصادقة).

        function bufferToBase64url(buffer) {
            const bytes = new Uint8Array(buffer);
            let str = '';
            for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }
        function base64urlToBuffer(base64url) {
            const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
            const base64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(base64);
            const buffer = new ArrayBuffer(raw.length);
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            return buffer;
        }

        // --- جسر تطبيق أندرويد الأصلي (WebView) ---
        function hasAndroidBiometricBridge() {
            return !!(window.Android && typeof window.Android.authenticateBiometric === 'function');
        }

        let _androidBiometricResolver = null;

        // دالة لطلب البصمة من تطبيق الأندرويد (بترجع Promise تتحل لما يوصل الرد)
        function requestBiometricAuth() {
            return new Promise((resolve) => {
                if (hasAndroidBiometricBridge()) {
                    _androidBiometricResolver = resolve;
                    window.Android.authenticateBiometric();
                } else {
                    console.log('هذه الميزة متاحة فقط داخل تطبيق الأندرويد.');
                    resolve(false);
                }
            });
        }

        // هذه الدالة يستدعيها تطبيق الأندرويد تلقائيًا بعد عملية البصمة
        function onBiometricResult(success, message) {
            if (_androidBiometricResolver) {
                const resolve = _androidBiometricResolver;
                _androidBiometricResolver = null;
                resolve(!!success);
            }
            if (!success && message) {
                console.warn('Biometric auth failed:', message);
            }
        }

        async function isBiometricAvailable() {
            if (hasAndroidBiometricBridge()) return true;
            try {
                return !!(window.PublicKeyCredential &&
                    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' &&
                    await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
            } catch (_) {
                return false;
            }
        }

        function getBiometricCredential() {
            const credId = localStorage.getItem('hotel_biometric_cred_id');
            const email  = localStorage.getItem('hotel_biometric_email');
            return (credId && email) ? { credId, email } : null;
        }

        function isBiometricRegisteredForCurrentUser() {
            const stored = getBiometricCredential();
            return !!(stored && stored.email === state.currentUserEmail);
        }

        function removeBiometricCredential() {
            localStorage.removeItem('hotel_biometric_cred_id');
            localStorage.removeItem('hotel_biometric_email');
        }

        async function offerBiometricSetup(email) {
            if (!email || email === GUEST_EMAIL) return;
            const existing = getBiometricCredential();
            if (existing && existing.email === email) return; // مفعّلة بالفعل لنفس المستخدم على هذا الجهاز
            if (!(await isBiometricAvailable())) return;
            showBiometricSetupPrompt(email);
        }

        function showBiometricSetupPrompt(email) {
            const existingModal = document.getElementById('biometricSetupModal');
            if (existingModal) existingModal.remove();
            const modal = document.createElement('div');
            modal.id = 'biometricSetupModal';
            modal.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-fade-in text-center">
                    <div class="w-20 h-20 bg-gradient-to-br from-slate-50 to-slate-100 rounded-[1.5rem] mx-auto mb-5 flex items-center justify-center border border-slate-200">
                        <i data-lucide="fingerprint" class="w-10 h-10 text-[#6E1418]"></i>
                    </div>
                    <h3 class="text-xl font-black text-[#6E1418] mb-2">تفعيل الدخول بالبصمة</h3>
                    <p class="text-sm text-slate-500 mb-6">هل تريد استخدام بصمتك لتسجيل الدخول تلقائيًا في المرات القادمة على هذا الجهاز؟</p>
                    <div class="flex gap-3">
                        <button id="biometricSetupSkip" class="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-3 rounded-xl border border-slate-200 transition-all">لاحقًا</button>
                        <button id="biometricSetupConfirm" class="flex-1 bg-[#6E1418] hover:bg-[#5a1013] text-white font-bold py-3 rounded-xl shadow-lg shadow-[#6E1418]/30 transition-all">تفعيل</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            if (typeof lucide !== 'undefined') lucide.createIcons();
            document.getElementById('biometricSetupSkip').onclick = () => modal.remove();
            document.getElementById('biometricSetupConfirm').onclick = async () => {
                modal.remove();
                await registerBiometric(email);
                render();
                updateLoginScreenBiometricButton();
            };
        }

        async function registerBiometric(email) {
            try {
                if (hasAndroidBiometricBridge()) {
                    // تأكيد فوري إن البصمة شغالة على الجهاز قبل تفعيلها في التطبيق
                    const ok = await requestBiometricAuth();
                    if (!ok) throw new Error('android biometric test failed');
                    localStorage.setItem('hotel_biometric_cred_id', 'android-native');
                    localStorage.setItem('hotel_biometric_email', email);
                    showToast('تم تفعيل الدخول بالبصمة على هذا الجهاز ✅', 'success');
                    return;
                }
                const challenge = crypto.getRandomValues(new Uint8Array(32));
                const userId = new TextEncoder().encode(email);
                const publicKey = {
                    challenge,
                    rp: { name: 'Resta Events Booking' },
                    user: { id: userId, name: email, displayName: email.split('@')[0] },
                    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
                    timeout: 60000,
                    attestation: 'none'
                };
                const cred = await navigator.credentials.create({ publicKey });
                if (!cred) throw new Error('no credential returned');
                localStorage.setItem('hotel_biometric_cred_id', bufferToBase64url(cred.rawId));
                localStorage.setItem('hotel_biometric_email', email);
                showToast('تم تفعيل الدخول بالبصمة على هذا الجهاز ✅', 'success');
            } catch (err) {
                console.error('Biometric registration error:', err);
                showToast('تعذر تفعيل البصمة على هذا الجهاز', 'error');
            }
        }

        async function toggleBiometricForCurrentUser() {
            if (isBiometricRegisteredForCurrentUser()) {
                removeBiometricCredential();
                showToast('تم إلغاء الدخول بالبصمة على هذا الجهاز', 'success');
                render();
            } else {
                await registerBiometric(state.currentUserEmail);
                render();
            }
            updateLoginScreenBiometricButton();
        }

        async function tryBiometricLogin() {
            const stored = getBiometricCredential();
            if (!stored || stored.email !== state.currentUserEmail) return false;
            try {
                if (hasAndroidBiometricBridge()) {
                    return await requestBiometricAuth();
                }
                const challenge = crypto.getRandomValues(new Uint8Array(32));
                const publicKey = {
                    challenge,
                    allowCredentials: [{ id: base64urlToBuffer(stored.credId), type: 'public-key' }],
                    userVerification: 'required',
                    timeout: 60000
                };
                const assertion = await navigator.credentials.get({ publicKey });
                return !!assertion;
            } catch (err) {
                console.warn('Biometric login failed or cancelled:', err);
                return false;
            }
        }

        // إظهار/إخفاء أيقونة البصمة في شاشة تسجيل الدخول الأولى حسب توفر البصمة
        // ووجود بصمة مسجّلة بالفعل على هذا الجهاز
        async function updateLoginScreenBiometricButton() {
            const btn = document.getElementById('loginScreenBiometricBtn');
            if (!btn) return;
            const stored = getBiometricCredential();
            if (stored && await isBiometricAvailable()) {
                btn.classList.remove('hidden');
            } else {
                btn.classList.add('hidden');
            }
        }

        // الدخول مباشرة بالبصمة من شاشة تسجيل الدخول الأولى (بدون كتابة إيميل/باسورد)
        async function loginWithBiometricFromLoginScreen() {
            const stored = getBiometricCredential();
            if (!stored) {
                showToast('لا يوجد بصمة مسجلة على هذا الجهاز بعد', 'error');
                return;
            }
            const btn = document.getElementById('loginScreenBiometricBtn');
            if (btn) btn.disabled = true;
            state.currentUserEmail = stored.email;
            const ok = await tryBiometricLogin();
            if (btn) btn.disabled = false;
            if (ok) {
                performLogin(stored.email);
            } else {
                showToast('تعذر التحقق من البصمة، حاول تسجيل الدخول بكلمة المرور', 'error');
            }
        }

        function unlockApp() {
            hideBiometricLockScreen();
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('app').style.display = 'block';
            render();
            if (CLOUD_ENABLED) setupRealtimeSync();
        }

        async function attemptAutoUnlock() {
            const stored = getBiometricCredential();
            const canTryBiometric = stored && stored.email === state.currentUserEmail &&
                state.currentUserEmail !== GUEST_EMAIL && await isBiometricAvailable();

            if (canTryBiometric) {
                showBiometricLockScreen();
                const ok = await tryBiometricLogin();
                if (ok) {
                    unlockApp();
                } else {
                    showBiometricFallback();
                }
            } else {
                unlockApp();
            }
        }

        function showBiometricLockScreen() {
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('app').style.display = 'none';
            const screen = document.getElementById('biometricLockScreen');
            screen.classList.remove('hidden');
            document.getElementById('biometricLockStatus').textContent = 'استخدم بصمتك لفتح التطبيق...';
            document.getElementById('biometricLockActions').classList.add('hidden');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        function hideBiometricLockScreen() {
            const screen = document.getElementById('biometricLockScreen');
            if (screen) screen.classList.add('hidden');
        }

        function showBiometricFallback() {
            document.getElementById('biometricLockStatus').textContent = 'تعذر التحقق من البصمة';
            document.getElementById('biometricLockActions').classList.remove('hidden');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        async function retryBiometricUnlock() {
            document.getElementById('biometricLockStatus').textContent = 'استخدم بصمتك لفتح التطبيق...';
            document.getElementById('biometricLockActions').classList.add('hidden');
            const ok = await tryBiometricLogin();
            if (ok) {
                unlockApp();
            } else {
                showBiometricFallback();
            }
        }

        function useBiometricFallbackPassword() {
            hideBiometricLockScreen();
            document.getElementById('loginModal').style.display = 'flex';
        }
        // ===================== End Biometric Login =====================

        // --- Admin Functions ---
        async function toggleUsersModal() {
            if (state.currentUserEmail !== ADMIN_EMAIL) {
                alert("غير مصرح لك بالدخول!");
                return;
            }
            await loadFromCloud();
            document.getElementById('usersModal').classList.remove('hidden');
            renderUsersTable();
        }

        function renderUsersTable() {
            const tbody = document.getElementById('usersTableBody');
            tbody.innerHTML = state.users.map(user => `
                <tr class="transition-colors hover:bg-slate-50">
                    <td class="font-bold text-slate-800" style="direction: ltr;">${user.email}</td>
                    <td><span class="font-mono text-[#A88A45] bg-[#A88A45]/10 rounded-lg px-3 py-1 font-bold text-xs">${user.password}</span></td>
                    <td class="text-sm text-slate-500 font-medium">${new Date(user.createdAt).toLocaleDateString('ar-EG')}</td>
                    <td class="flex items-center gap-2 justify-end">
                        <button onclick="changeUserPassword('${user.email}')" class="p-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors" title="تغيير كلمة المرور">
                            <i data-lucide="key" class="w-4 h-4"></i>
                        </button>
                        ${user.email !== ADMIN_EMAIL ? `
                            <button onclick="deleteUser('${user.email}')" class="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors" title="حذف المستخدم">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        ` : '<span class="text-xs font-bold text-white bg-slate-800 px-3 py-1 rounded-full mx-2">أدمن النظام</span>'}
                    </td>
                </tr>
            `).join('');
            if(typeof lucide!=="undefined") lucide.createIcons();
        }

        function deleteUser(email) {
            if (email === ADMIN_EMAIL) return;
            if(confirm(`هل أنت متأكد من حذف المستخدم ${email}؟ \nلن يتمكن من الدخول مرة أخرى.`)) {
                state.users = state.users.filter(u => u.email !== email);
                if (!state.pendingDeletedUsers.includes(email)) {
                    state.pendingDeletedUsers.push(email);
                }
                // ارفع العداد لضمان أولوية هذه العملية في syncToCloud
                state._opsVersion++;
                localStorage.setItem('hotel_deleted_users', JSON.stringify(state.pendingDeletedUsers));
                saveUsers();
                syncToCloud();
                renderUsersTable();
                showToast(`تم حذف المستخدم ${email} بنجاح. جاري المزامنة مع السحابة...`, 'success');
            }
        }

        function changeUserPassword(email) {
            const newPass = prompt(`أدخل كلمة المرور الجديدة للمستخدم ${email}:`);
            if(newPass && newPass.trim() !== "") {
                const userIndex = state.users.findIndex(u => u.email === email);
                if(userIndex !== -1) {
                    state.users[userIndex].password = newPass.trim();
                    markUserDirty(email);
                    saveUsers();
                    syncToCloud();
                    renderUsersTable();
                    showToast("تم تحديث كلمة المرور بنجاح.", 'success');
                }
            }
        }

        function addNewUser() {
            if (state.currentUserEmail !== ADMIN_EMAIL) return;

            const emailInput = document.getElementById('newUserEmail');
            const passInput  = document.getElementById('newUserPassword');
            const email    = (emailInput.value || '').trim().toLowerCase();
            const password = (passInput.value  || '').trim();

            // Validation: missing fields
            if (!email || !password) {
                showToast('يرجى إدخال البريد الإلكتروني وكلمة المرور.', 'error');
                return;
            }

            // Validation: email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showToast('البريد الإلكتروني غير صحيح. يرجى إدخال بريد صحيح.', 'error');
                return;
            }

            // Validation: duplicate email
            if (state.users.find(u => u.email === email)) {
                showToast('هذا البريد الإلكتروني مسجل مسبقاً في النظام.', 'error');
                return;
            }

            // Create user
            state.users.push({ email: email, password: password, createdAt: new Date().toISOString() });
            markUserDirty(email);
            saveUsers();
            syncToCloud();
            renderUsersTable();

            // Clear inputs
            emailInput.value = '';
            passInput.value  = '';

            showToast(`تم إنشاء حساب المستخدم (${email}) بنجاح ✓`, 'success');
        }

        function toggleBookingsListModal() {
            const modal = document.getElementById('bookingsListModal');
            if (modal.classList.contains('hidden')) {
                const tbody = document.getElementById('allBookingsTableBody');
                const today = new Date().toISOString().split('T')[0];
                const sortedBookings = [...state.bookings]
                    .filter(b => b.startDate >= today)
                    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

                if (sortedBookings.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center py-16 text-slate-400 font-bold bg-white"><div class="flex flex-col items-center justify-center"><i data-lucide="calendar-x" class="w-12 h-12 mb-3 text-slate-300"></i>لا توجد حجوزات قادمة مسجلة في النظام</div></td></tr>';
                } else {
                    tbody.innerHTML = sortedBookings.map(b => {
                        const hall = HALLS.find(h => h.id === b.hallId) || { name: 'غير معروف', color: 'bg-gray-100 text-gray-500' };
                        return `
                            <tr onclick="showDayDetails('${b.startDate}')" class="cursor-pointer hover:bg-slate-50 transition-all border-l-4 border-transparent hover:border-[#A88A45] bg-white group">
                                <td class="font-bold text-[#6E1418] group-hover:pl-2 transition-all">${escapeHtml(b.companyName)}</td>
                                <td><span class="text-xs px-3 py-1.5 rounded-lg font-bold ${hall.color}">${hall.name}</span></td>
                                <td class="text-slate-600 dir-ltr font-mono text-xs">${b.startDate}</td>
                                <td class="text-slate-600 dir-ltr font-mono text-xs">${b.endDate}</td>
                            </tr>
                        `;
                    }).join('');
                }
                modal.classList.remove('hidden');
                if(typeof lucide!=="undefined") lucide.createIcons();
            } else {
                modal.classList.add('hidden');
            }
        }

        // ─── Drag & Drop: Move a booking to another day ──────────────────
        let draggedBookingId = null;
        // ─── Undo/Redo لعمليات نقل الحجوزات (سحب وإفلات) ──────────────────
        let moveUndoStack = [];
        let moveRedoStack = [];
        const MOVE_HISTORY_LIMIT = 50;
        let monthSwitchTimer = null;
        let dragAutoScrollRAF = null;
        let dragPointerY = null;

        // يتابع مكان المؤشر أثناء السحب (dragover) ويشغّل حلقة التمرير التلقائي
        function handleGlobalDragAutoScroll(e) {
            if (!draggedBookingId) return;
            dragPointerY = e.clientY;
            startDragAutoScroll();
        }

        // بديل عبر اللمس لبعض متصفحات الموبايل التي قد ترسل touchmove أثناء السحب
        function handleGlobalTouchAutoScroll(e) {
            if (!draggedBookingId) return;
            const touch = e.touches && e.touches[0];
            if (!touch) return;
            dragPointerY = touch.clientY;
            startDragAutoScroll();
        }

        function startDragAutoScroll() {
            if (dragAutoScrollRAF) return;
            const EDGE = 90;   // منطقة الحساسية عند حافتي الشاشة (px)
            const MAX_SPEED = 16; // أقصى سرعة تمرير لكل إطار (px)
            const step = () => {
                if (!draggedBookingId || dragPointerY === null) {
                    dragAutoScrollRAF = null;
                    return;
                }
                const vh = window.innerHeight;
                if (dragPointerY < EDGE) {
                    const intensity = (EDGE - dragPointerY) / EDGE;
                    window.scrollBy(0, -Math.ceil(MAX_SPEED * intensity));
                } else if (dragPointerY > vh - EDGE) {
                    const intensity = (dragPointerY - (vh - EDGE)) / EDGE;
                    window.scrollBy(0, Math.ceil(MAX_SPEED * intensity));
                }
                dragAutoScrollRAF = requestAnimationFrame(step);
            };
            dragAutoScrollRAF = requestAnimationFrame(step);
        }

        function stopDragAutoScroll() {
            dragPointerY = null;
            if (dragAutoScrollRAF) {
                cancelAnimationFrame(dragAutoScrollRAF);
                dragAutoScrollRAF = null;
            }
        }

        function clearMonthSwitchTimer() {
            if (monthSwitchTimer) {
                clearTimeout(monthSwitchTimer);
                monthSwitchTimer = null;
            }
        }

        // اسحب الحجز فوق سهم الشهر السابق/التالي واستمر بضع لحظات للتنقل بين الشهور أثناء السحب
        function handleMonthNavDragOver(e, delta) {
            if (!draggedBookingId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            if (monthSwitchTimer) return;
            if (e.currentTarget) e.currentTarget.classList.add('drag-over');
            monthSwitchTimer = setTimeout(() => {
                monthSwitchTimer = null;
                if (draggedBookingId) changeMonth(delta);
            }, 650);
        }

        function handleMonthNavDragLeave(e) {
            if (e.currentTarget) e.currentTarget.classList.remove('drag-over');
            clearMonthSwitchTimer();
        }

        function handleBookingDragStart(e, id) {
            const booking = state.bookings.find(b => b.id === id);
            const canDrag = booking && (state.currentUserEmail === ADMIN_EMAIL || booking.createdBy === state.currentUserEmail);
            if (!canDrag) {
                e.preventDefault();
                return;
            }
            draggedBookingId = id;
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', id); } catch (err) {}
            }
            if (e.currentTarget) e.currentTarget.classList.add('dragging');
        }

        function handleBookingDragEnd(e) {
            if (e.currentTarget) e.currentTarget.classList.remove('dragging');
            draggedBookingId = null;
            clearMonthSwitchTimer();
            stopDragAutoScroll();
            document.querySelectorAll('.day-cell.drag-over').forEach(el => el.classList.remove('drag-over'));
        }

        function handleDayDragOver(e) {
            if (!draggedBookingId) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            if (e.currentTarget) e.currentTarget.classList.add('drag-over');
        }

        function handleDayDragLeave(e) {
            if (e.currentTarget) e.currentTarget.classList.remove('drag-over');
        }

        function handleDayDrop(e, newDate) {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget) e.currentTarget.classList.remove('drag-over');
            clearMonthSwitchTimer();
            stopDragAutoScroll();
            const id = draggedBookingId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
            draggedBookingId = null;
            if (!id) return;
            moveBookingToDate(id, newDate);
        }

        function moveBookingToDate(id, newDate, _skipHistory) {
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            // صلاحية النقل: صاحب الحجز نفسه أو الأدمن فقط
            const canMove = state.currentUserEmail === ADMIN_EMAIL || booking.createdBy === state.currentUserEmail;
            if (!canMove) {
                showToast('عذراً، يمكنك نقل حجوزاتك الخاصة فقط.', 'error');
                return;
            }

            // الأيام المنصرمة: لا يمكن نقل حجز منها إلا للأدمن، ولا يمكن النقل إليها إطلاقاً
            if (state.currentUserEmail !== ADMIN_EMAIL && isPastDateStr(booking.startDate)) {
                showToast('عذراً، هذا حجز في يوم منصرم، ولا يمكن نقله إلا من قبل الأدمن.', 'error');
                return;
            }
            if (isPastDateStr(newDate)) {
                showToast('لا يمكن نقل حجوزات إلى الأيام المنصرمة.', 'error');
                return;
            }

            if (booking.startDate === newDate) return;

            // فحص التعارض في القاعة نفسها باليوم الجديد (تجاهل هذا اليوم فقط من الحجز)
            if (checkConflict(booking.hallId, newDate, booking.startTime, booking.endTime, booking.id, false)) {
                showToast('عذراً، يوجد حجز آخر في نفس التوقيت بتاريخ ' + newDate.split('-').reverse().join('/') + '.', 'error');
                return;
            }

            const oldDate = booking.startDate;
            booking.startDate = newDate;
            booking._isDirty = true;

            if (!_skipHistory) {
                moveUndoStack.push({ id, oldDate, newDate });
                if (moveUndoStack.length > MOVE_HISTORY_LIMIT) moveUndoStack.shift();
                moveRedoStack = [];
            }

            // إبقاء نطاق العرض متزامناً مع أيام المجموعة الفعلية
            const groupId = booking.groupId || booking.id;
            const groupDays = state.bookings.filter(b => b.groupId === groupId || b.id === groupId);
            if (groupDays.length) {
                const sortedDates = groupDays.map(b => b.startDate).slice().sort();
                const newRange = sortedDates[0] + ' to ' + sortedDates[sortedDates.length - 1];
                groupDays.forEach(b => { b.originalRange = newRange; });
            }

            const fmtOld = oldDate.split('-').reverse().join('/');
            const fmtNew = newDate.split('-').reverse().join('/');
            const logMsg = 'تم نقل حجز - ' + booking.companyName + ' - من ' + fmtOld + ' إلى ' + fmtNew;

            addNotification(logMsg, 'add', newDate);
            showToast(logMsg, 'success', newDate);

            state.activityLogs.unshift({
                type:         'نقل',
                company:      booking.companyName,
                hallName:     booking.hallName || '',
                user:         state.currentUserEmail,
                date:         new Date().toLocaleDateString('ar-EG'),
                time:         new Date().toLocaleTimeString('ar-EG'),
                isoTimestamp: new Date().toISOString()
            });

            saveLocal();
            render();
        }

        function performUndo() {
            if (!moveUndoStack.length) return;
            const action = moveUndoStack[moveUndoStack.length - 1];
            const booking = state.bookings.find(b => b.id === action.id);
            if (!booking || booking.startDate !== action.newDate) {
                // الحجز اتغيّر أو اتحذف من وقتها، نلغي هذه العملية من السجل
                moveUndoStack.pop();
                render();
                return;
            }
            moveBookingToDate(action.id, action.oldDate, true);
            if (booking.startDate === action.oldDate) {
                moveUndoStack.pop();
                moveRedoStack.push(action);
            }
            render();
        }

        function performRedo() {
            if (!moveRedoStack.length) return;
            const action = moveRedoStack[moveRedoStack.length - 1];
            const booking = state.bookings.find(b => b.id === action.id);
            if (!booking || booking.startDate !== action.oldDate) {
                moveRedoStack.pop();
                render();
                return;
            }
            moveBookingToDate(action.id, action.newDate, true);
            if (booking.startDate === action.newDate) {
                moveRedoStack.pop();
                moveUndoStack.push(action);
            }
            render();
        }

        function checkConflict(hallId, date, startTime, endTime, ignoreId = null, ignoreGroup = false) {
            return state.bookings.some(b => {
                if (ignoreId) {
                    if (ignoreGroup && (b.groupId === ignoreId || b.id === ignoreId)) return false;
                    if (!ignoreGroup && b.id === ignoreId) return false;
                }
                if (b.hallId !== hallId || b.startDate !== date) return false;
                const isFullDayNew = !startTime || !endTime;
                const isFullDayExisting = !b.startTime || !b.endTime;
                if (isFullDayNew || isFullDayExisting) return true;
                return (startTime < b.endTime && endTime > b.startTime);
            });
        }

        // ─── Touch-based Drag & Drop (Mobile long-press) ──────────────────
        // HTML5's native drag events don't work reliably via touch on mobile
        // browsers, so this reimplements the same "move booking to another
        // day" behavior using touchstart/touchmove/touchend + a long-press,
        // reusing moveBookingToDate() so the underlying logic stays identical.
        let touchDragId = null;
        let touchDragTimer = null;
        let touchDragActive = false;
        let touchStartX = 0, touchStartY = 0;
        let touchGhostEl = null;
        let touchCurrentDayCell = null;
        let touchSourceEl = null;

        const TOUCH_LONG_PRESS_MS = 1000;
        const TOUCH_MOVE_TOLERANCE = 10;

        function clearTouchDragTimer() {
            if (touchDragTimer) {
                clearTimeout(touchDragTimer);
                touchDragTimer = null;
            }
        }

        function handleBookingTouchStart(e, id) {
            const booking = state.bookings.find(b => b.id === id);
            const canDrag = booking && (state.currentUserEmail === ADMIN_EMAIL || booking.createdBy === state.currentUserEmail);
            if (!canDrag) return;

            const touch = e.touches[0];
            if (!touch) return;

            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchDragId = id;
            touchDragActive = false;
            touchSourceEl = e.currentTarget;
            clearTouchDragTimer();

            // نلغي قدرة العنصر على بدء سحب HTML5 الأصلي أثناء اللمس، لأن
            // كروم/إيدج على أندرويد بيحاولوا ياخدوا التحكم في اللمسة الطويلة
            // لأنفسهم (سحب أصلي/تحديد) ده بيلغي لمساتنا فجأة (touchcancel)
            // وبيرجّع العنصر مكانه. بنرجّع draggable=true تاني بعد ما اللمس يخلص
            // عشان السحب بالماوس على الديسكتوب يفضل شغال زي ما هو.
            touchSourceEl.setAttribute('draggable', 'false');

            touchDragTimer = setTimeout(() => {
                touchDragTimer = null;
                startTouchDrag(touch.clientX, touch.clientY);
            }, TOUCH_LONG_PRESS_MS);
        }

        function startTouchDrag(x, y) {
            if (!touchDragId || !touchSourceEl) return;
            touchDragActive = true;
            touchSourceEl.classList.add('dragging');

            if (navigator.vibrate) { try { navigator.vibrate(15); } catch (err) {} }

            touchGhostEl = touchSourceEl.cloneNode(true);
            touchGhostEl.classList.add('touch-drag-ghost');
            touchGhostEl.style.width = touchSourceEl.offsetWidth + 'px';
            document.body.appendChild(touchGhostEl);
            positionTouchGhost(x, y);
        }

        function positionTouchGhost(x, y) {
            if (!touchGhostEl) return;
            touchGhostEl.style.left = x + 'px';
            touchGhostEl.style.top = y + 'px';
        }

        function restoreTouchDraggable() {
            if (touchSourceEl) touchSourceEl.setAttribute('draggable', 'true');
        }

        function handleBookingTouchMove(e) {
            if (!touchDragId) return;
            const touch = e.touches[0];
            if (!touch) return;

            if (!touchDragActive) {
                // لسه مستنيين الضغطة المطولة تكتمل - لو المستخدم حرّك إصبعه
                // بشكل واضح، يبقى غالبًا بيعمل سكرول عادي، فنلغي محاولة السحب
                const dx = Math.abs(touch.clientX - touchStartX);
                const dy = Math.abs(touch.clientY - touchStartY);
                if (dx > TOUCH_MOVE_TOLERANCE || dy > TOUCH_MOVE_TOLERANCE) {
                    clearTouchDragTimer();
                    restoreTouchDraggable();
                    touchDragId = null;
                    touchSourceEl = null;
                }
                return;
            }

            // وضع السحب الفعلي: امنع سكرول الصفحة الافتراضي وحرّك العنصر الوهمي
            e.preventDefault();
            positionTouchGhost(touch.clientX, touch.clientY);
            dragPointerY = touch.clientY;
            startDragAutoScroll();

            const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
            const dayCell = elUnder ? elUnder.closest('.day-cell[data-date]') : null;
            const navBtn = elUnder ? elUnder.closest('[data-month-nav]') : null;

            if (navBtn) {
                if (touchCurrentDayCell) { touchCurrentDayCell.classList.remove('drag-over'); touchCurrentDayCell = null; }
                if (!navBtn.classList.contains('drag-over')) {
                    document.querySelectorAll('[data-month-nav].drag-over').forEach(b => b.classList.remove('drag-over'));
                    navBtn.classList.add('drag-over');
                }
                if (!monthSwitchTimer) {
                    const delta = parseInt(navBtn.getAttribute('data-month-nav'), 10);
                    monthSwitchTimer = setTimeout(() => {
                        monthSwitchTimer = null;
                        if (touchDragActive) changeMonth(delta);
                    }, 650);
                }
                return;
            }

            document.querySelectorAll('[data-month-nav].drag-over').forEach(b => b.classList.remove('drag-over'));
            clearMonthSwitchTimer();

            if (dayCell !== touchCurrentDayCell) {
                if (touchCurrentDayCell) touchCurrentDayCell.classList.remove('drag-over');
                touchCurrentDayCell = dayCell;
                if (touchCurrentDayCell) touchCurrentDayCell.classList.add('drag-over');
            }
        }

        function cleanupTouchDrag() {
            if (touchGhostEl) { touchGhostEl.remove(); touchGhostEl = null; }
            restoreTouchDraggable();
            document.querySelectorAll('.booking-tag.dragging').forEach(elx => elx.classList.remove('dragging'));
            if (touchCurrentDayCell) touchCurrentDayCell.classList.remove('drag-over');
            touchCurrentDayCell = null;
            document.querySelectorAll('[data-month-nav].drag-over').forEach(b => b.classList.remove('drag-over'));
            clearMonthSwitchTimer();
            touchDragActive = false;
            touchDragId = null;
            touchSourceEl = null;
            stopDragAutoScroll();
        }

        function handleBookingTouchEnd(e) {
            clearTouchDragTimer();

            if (!touchDragActive) {
                restoreTouchDraggable();
                touchDragId = null;
                touchSourceEl = null;
                return;
            }

            const id = touchDragId;
            const dayCell = touchCurrentDayCell;
            cleanupTouchDrag();

            if (dayCell && id) {
                const newDate = dayCell.getAttribute('data-date');
                if (newDate) moveBookingToDate(id, newDate);
            }

            // امنع الـ "click" الوهمي اللي بيولّده المتصفح بعد اللمس، عشان
            // منفتحش تفاصيل اليوم بالغلط بعد إتمام عملية السحب
            e.preventDefault();
        }

        function handleBookingTouchCancel() {
            clearTouchDragTimer();
            cleanupTouchDrag();
        }

        function editBooking(id) {
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            if (state.currentUserEmail !== ADMIN_EMAIL && state.currentUserEmail !== booking.createdBy) {
                alert("عذراً، ليس لديك صلاحية تعديل هذا الحجز.");
                return;
            }

            if (state.currentUserEmail !== ADMIN_EMAIL && isPastDateStr(booking.startDate)) {
                alert("عذراً، هذا حجز في يوم منصرم، ولا يمكن تعديله إلا من قبل الأدمن.");
                return;
            }

            closeDetailsModal();
            const groupId = booking.groupId || id;
            openGlobalBookingForEdit(id, groupId);
        }

        function deleteBooking(id) {
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            if (state.currentUserEmail !== ADMIN_EMAIL && state.currentUserEmail !== booking.createdBy) {
                alert("عذراً، ليس لديك صلاحية حذف هذا الحجز.");
                return;
            }

            if (state.currentUserEmail !== ADMIN_EMAIL && isPastDateStr(booking.startDate)) {
                alert("عذراً، هذا حجز في يوم منصرم، ولا يمكن حذفه إلا من قبل الأدمن.");
                return;
            }

            const groupId = booking.groupId || id;
            const groupDays = state.bookings.filter(b => b.groupId === groupId || b.id === groupId);
            const hasMultipleDays = groupDays.length > 1;
            const fmtDate = d => d ? d.split('-').reverse().join('/') : '';

            const modal = document.getElementById('deleteConfirmModal');
            const msgEl = document.getElementById('deleteConfirmMessage');
            const btnsEl = document.getElementById('deleteConfirmButtons');

            if (hasMultipleDays) {
                msgEl.innerHTML =
                    'هذا الحجز <strong class="text-[#6E1418]">' + booking.companyName + '</strong> يشمل <strong>' + groupDays.length + ' أيام</strong>.<br>' +
                    'ماذا تريد أن تحذف؟';

                btnsEl.innerHTML = `
                    <button onclick="confirmDeleteOneDay('${id}')" class="w-full py-3.5 text-sm font-black text-orange-700 bg-orange-50 border border-orange-200 rounded-xl hover:bg-orange-600 hover:text-white hover:border-orange-600 transition-all flex items-center justify-center gap-2 shadow-sm">
                        <i data-lucide="calendar-x" class="w-5 h-5"></i>
                        حذف هذا اليوم فقط (${fmtDate(booking.startDate)})
                    </button>
                    <button onclick="confirmDeleteAllDays('${id}', '${groupId}')" class="w-full py-3.5 text-sm font-black text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-600 hover:text-white hover:border-red-600 transition-all flex items-center justify-center gap-2 shadow-sm">
                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                        حذف الحجز بالكامل (${groupDays.length} أيام)
                    </button>
                `;
            } else {
                msgEl.innerHTML =
                    'هل أنت متأكد من حذف حجز <strong class="text-[#6E1418]">' + booking.companyName + '</strong> بتاريخ <strong>' + fmtDate(booking.startDate) + '</strong>؟';

                btnsEl.innerHTML = `
                    <button onclick="confirmDeleteOneDay('${id}')" class="w-full py-3.5 text-sm font-black text-red-700 bg-red-50 border border-red-200 rounded-xl hover:bg-red-600 hover:text-white hover:border-red-600 transition-all flex items-center justify-center gap-2 shadow-sm">
                        <i data-lucide="trash-2" class="w-5 h-5"></i>
                        نعم، احذف هذا الحجز
                    </button>
                `;
            }

            modal.classList.remove('hidden');
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function closeDeleteConfirmModal() {
            document.getElementById('deleteConfirmModal').classList.add('hidden');
        }

        function confirmDeleteOneDay(id) {
            closeDeleteConfirmModal();
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            state.pendingDeletions.push(id);
            state.bookings = state.bookings.filter(b => b.id !== id);

            // تسجيل الحجز المحذوف على جوجل شيت منفصل
            logDeletedBookingToCloud(booking, 'يوم واحد');

            const _fmtDel = booking.startDate ? booking.startDate.split('-').reverse().join('/') : '';
            const logMsg = 'تم حذف يوم من حجز - ' + booking.companyName + ' - بتاريخ ' + _fmtDel;

            addNotification(logMsg, 'delete', booking.startDate);
            showToast(logMsg, 'error');

            state.activityLogs.unshift({
                type:         'حذف',
                company:      booking.companyName,
                hallName:     (HALLS.find(h => h.id === booking.hallId) || {}).name || booking.hallName || '',
                user:         state.currentUserEmail,
                bookingId:    booking.id || '',
                startDate:    booking.startDate || '',
                date:         new Date().toLocaleDateString('ar-EG'),
                time:         new Date().toLocaleTimeString('ar-EG'),
                isoTimestamp: new Date().toISOString()
            });

            saveLocal();
            render();

            const detailsModal = document.getElementById('detailsModal');
            if (!detailsModal.classList.contains('hidden')) {
                const dateTitle = document.getElementById('modalDateTitle').dataset.date;
                const remaining = state.bookings.filter(b => b.startDate === dateTitle && (state.view === 'dashboard' || b.hallId === state.selectedHall?.id));
                if (remaining.length === 0) {
                    closeDetailsModal();
                } else {
                    showDayDetails(dateTitle);
                }
            }
        }

        function confirmDeleteAllDays(id, groupId) {
            closeDeleteConfirmModal();
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            const groupDays = state.bookings.filter(b => b.groupId === groupId || b.id === groupId);
            const toDeleteIds = groupDays.map(b => b.id);
            toDeleteIds.forEach(did => state.pendingDeletions.push(did));
            state.bookings = state.bookings.filter(b => b.groupId !== groupId && b.id !== groupId);

            // تسجيل كل يوم من الحجز المحذوف بالكامل على جوجل شيت منفصل
            groupDays.forEach(gb => logDeletedBookingToCloud(gb, 'الحجز بالكامل'));

            const _fmtDel = booking.startDate ? booking.startDate.split('-').reverse().join('/') : '';
            const logMsg = 'تم إلغاء الحجز بالكامل - ' + booking.companyName + ' - بتاريخ ' + _fmtDel;

            addNotification(logMsg, 'delete', booking.startDate);
            showToast(logMsg, 'error');

            state.activityLogs.unshift({
                type:         'حذف',
                company:      booking.companyName,
                hallName:     (HALLS.find(h => h.id === booking.hallId) || {}).name || booking.hallName || '',
                user:         state.currentUserEmail,
                bookingId:    booking.id || '',
                startDate:    booking.startDate || '',
                date:         new Date().toLocaleDateString('ar-EG'),
                time:         new Date().toLocaleTimeString('ar-EG'),
                isoTimestamp: new Date().toISOString()
            });

            saveLocal();
            render();

            const detailsModal = document.getElementById('detailsModal');
            if (!detailsModal.classList.contains('hidden')) {
                const dateTitle = document.getElementById('modalDateTitle').dataset.date;
                const remaining = state.bookings.filter(b => b.startDate === dateTitle && (state.view === 'dashboard' || b.hallId === state.selectedHall?.id));
                if (remaining.length === 0) {
                    closeDetailsModal();
                } else {
                    showDayDetails(dateTitle);
                }
            }
        }

        function showDayDetails(dateStr) {
            let bookings = state.bookings.filter(b => b.startDate === dateStr);
            if (state.view !== 'dashboard' && state.selectedHall) {
                bookings = bookings.filter(b => b.hallId === state.selectedHall.id);
            }
            if (bookings.length === 0) return;

            const modal = document.getElementById('detailsModal');
            const content = document.getElementById('modalContent');
            const title = document.getElementById('modalDateTitle');
            const hallTitle = document.getElementById('modalHallTitle');

            // Format date for display
            const displayDateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const prettyDate = new Date(dateStr).toLocaleDateString('ar-EG', displayDateOptions);

            title.innerText = prettyDate;
            title.dataset.date = dateStr;
            hallTitle.innerText = state.view === 'dashboard' ? 'سجل حجوزات اليوم لجميع القاعات' : state.selectedHall.name;

            // إضافة زر حجز جديد في رأس نافذة التفاصيل
            const actionsEl = document.getElementById('detailsModalActions');
            if (actionsEl) {
                const fullDayBookedHallIds = state.bookings
                    .filter(b => b.startDate === dateStr && (!b.startTime || !b.endTime))
                    .map(b => b.hallId);
                const availableCount = HALLS.filter(h => !fullDayBookedHallIds.includes(h.id)).length;
                actionsEl.innerHTML = (availableCount > 0 && !isGuest() && (state.currentUserEmail === ADMIN_EMAIL || !isPastDateStr(dateStr))) ? `
                    <button onclick="openNewBookingForDate('${dateStr}')"
                        class="flex items-center gap-2 bg-white/10 hover:bg-[#A88A45]/30 border border-white/20 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-200"
                        title="إضافة حجز جديد لهذا اليوم">
                        <i data-lucide="calendar-plus" class="w-4 h-4 text-[#A88A45]"></i>
                        <span class="hidden sm:inline text-white">حجز جديد</span>
                    </button>
                ` : '';
            }

            // Remove any leftover attachment dropdowns from a previous render
            // before wiping the list (they live under <body>, not under
            // #modalContent, since toggleAttachmentDropdown() reparents them).
            cleanupAttachmentDropdowns();

            content.innerHTML = bookings.map(b => {
                const hall = HALLS.find(h => h.id === b.hallId);
                const isOwner = b.createdBy === state.currentUserEmail;
                const isAdmin = state.currentUserEmail === ADMIN_EMAIL;
                const canControl = isAdmin || (isOwner && !isPastDateStr(b.startDate));

                if (b.detailsHidden && !isAdmin) {
                    return `
                        <div class="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm border-r-4 ${hall.border} flex items-center justify-between gap-3 flex-wrap">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-black px-3 py-1 rounded-lg ${hall.color}">${hall.name}</span>
                                <h4 class="font-black text-lg text-[#6E1418]">${escapeHtml(b.companyName)}</h4>
                            </div>
                            <div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg shrink-0">
                                <i data-lucide="eye-off" class="w-3 h-3"></i> باقي التفاصيل مخفية
                            </div>
                        </div>
                    `;
                }

                return `
                    <div class="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm border-r-4 ${hall.border} relative overflow-hidden group hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1">
                        <div class="flex justify-between items-start">
                            <div class="w-full">
                                <div class="flex items-center justify-between mb-2 w-full">
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs font-black px-3 py-1 rounded-lg ${hall.color}">${hall.name}</span>

                                        ${isOwner ? '<span class="text-xs font-bold px-3 py-1 rounded-lg bg-[#A88A45]/20 text-[#8f753a] flex items-center gap-1"><i data-lucide="user-check" class="w-3 h-3"></i> حجزي</span>' : ''}

                                    </div>
                                    ${isAdmin ? `
                                        <button onclick="toggleBookingDetailsVisibility('${b.id}')" class="shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${b.detailsHidden ? 'text-white bg-[#6E1418] border-[#6E1418] hover:bg-[#5a1013]' : 'text-slate-500 bg-white border-slate-200 hover:text-[#6E1418] hover:border-[#6E1418]/30'}" title="${b.detailsHidden ? 'إظهار تفاصيل هذا الحجز لباقي المستخدمين' : 'إخفاء تفاصيل هذا الحجز عن باقي المستخدمين'}">
                                            <i data-lucide="${b.detailsHidden ? 'eye-off' : 'eye'}" class="w-3.5 h-3.5"></i>
                                            <span class="hidden sm:inline">${b.detailsHidden ? 'إظهار التفاصيل' : 'إخفاء التفاصيل'}</span>
                                        </button>
                                    ` : ''}
                                </div>
                                <h4 class="font-black text-xl text-[#6E1418] mt-3 mb-4">${escapeHtml(b.companyName)}</h4>
                                <div class="grid grid-cols-2 gap-3 text-sm text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <div class="flex items-center gap-2"><div class="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center shrink-0"><i data-lucide="clock" class="w-3.5 h-3.5 text-[#A88A45]"></i></div> <span class="font-bold">${b.startTime || 'يوم كامل'} - ${b.endTime || 'يوم كامل'}</span></div>
                                    <div class="flex items-center gap-2"><div class="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center shrink-0"><i data-lucide="user" class="w-3.5 h-3.5 text-[#A88A45]"></i></div> <span class="font-medium truncate">${escapeHtml(b.employee) || 'غير محدد'}</span></div>
                                    <div class="flex items-center gap-2 col-span-2">${b.phone ? `<a href="tel:${escapeHtml(b.phone)}" class="flex items-center gap-2 group" title="اتصال بـ ${escapeHtml(b.phone)}"><div class="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center shrink-0 group-hover:bg-green-50 group-active:bg-green-100 transition-colors"><i data-lucide="phone" class="w-3.5 h-3.5 text-[#A88A45] group-hover:text-green-600 transition-colors"></i></div><span class="font-medium font-mono dir-ltr group-hover:text-green-600 transition-colors underline-offset-2 group-hover:underline">${escapeHtml(b.phone)}</span></a><a href="${getWhatsAppLink(b.phone)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="flex items-center justify-center shrink-0 group/wa" title="واتساب ${escapeHtml(b.phone)}"><div class="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center shrink-0 group-hover/wa:bg-green-50 group-active/wa:bg-green-100 transition-colors"><svg viewBox="0 0 24 24" class="w-3.5 h-3.5 fill-[#A88A45] group-hover/wa:fill-green-600 transition-colors"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2m0 1.67a8.2 8.2 0 018.24 8.24c0 4.55-3.7 8.24-8.25 8.24a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.26-4.38c0-4.55 3.7-8.24 8.25-8.24m-4.53 4.72c-.16 0-.42.06-.64.31s-.85.83-.85 2.03.87 2.36.99 2.52c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28s-1.44-.71-1.66-.79-.39-.12-.55.12c-.16.24-.63.79-.77.95-.14.16-.28.18-.53.06-.24-.12-1.02-.38-1.95-1.2-.72-.64-1.2-1.44-1.35-1.68-.14-.24-.02-.37.11-.5.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.35-.76-1.84-.2-.48-.4-.42-.55-.42h-.47" /></svg></div></a>` : `<div class="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center shrink-0"><i data-lucide="phone" class="w-3.5 h-3.5 text-[#A88A45]"></i></div><span class="font-medium text-slate-400">لا يوجد رقم</span>`}</div>
                                </div>
                                
                                ${b.notes ? `
                                <div class="mt-4 p-3 bg-amber-50/50 rounded-xl text-sm text-amber-900 border border-amber-100/50 flex items-start gap-2">
                                    <i data-lucide="info" class="w-4 h-4 mt-0.5 text-amber-600 shrink-0"></i>
                                    <p class="leading-relaxed font-medium">${escapeHtml(b.notes)}</p>
                                </div>` : ''}

                                ${(() => {
                                    if (b.eventType !== 'wedding' || !b.wedding) return '';
                                    const rows = weddingSummaryRows(b).filter(r => r[0] !== 'المنيو' && r[0] !== 'ملاحظات المنيو');
                                    const remainingClass = (b.wedding.remaining > 0) ? 'text-red-600' : 'text-emerald-700';
                                    // منيو الباقة
                                    const pkg = state.weddingSettings.packages.find(p => p.id === b.wedding.packageId);
                                    const menuItems = (b.wedding.menuItems && b.wedding.menuItems.filter(m => m.trim()).length) ? b.wedding.menuItems.filter(m => m.trim()) : (pkg && pkg.menuItems ? pkg.menuItems.filter(m => m.trim()) : []);
                                    const menuNotes = (b.wedding.menuNotes && b.wedding.menuNotes.trim()) ? b.wedding.menuNotes.trim() : (pkg && pkg.menuNotes ? pkg.menuNotes.trim() : '');
                                    const menuHtml = (menuItems.length || menuNotes) ? `
                                        <div class="mt-3 pt-3 border-t border-[#6E1418]/10">
                                            <div class="flex items-center gap-1.5 text-[11px] font-black text-[#A88A45] mb-2"><i data-lucide="utensils" class="w-3.5 h-3.5"></i> منيو الباقة</div>
                                            ${menuItems.length ? `<div class="flex flex-wrap gap-1.5 mb-2">${menuItems.map(item => `<span class="text-xs font-bold bg-[#A88A45]/10 text-[#8f753a] px-2.5 py-1 rounded-lg border border-[#A88A45]/20">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
                                            ${menuNotes ? `<p class="text-xs text-slate-500 font-medium bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">${escapeHtml(menuNotes)}</p>` : ''}
                                        </div>` : '';
                                    return `<div class="mt-4 p-3 bg-[#6E1418]/5 rounded-xl border border-[#6E1418]/10 space-y-1.5 text-sm">
                                        <div class="flex items-center gap-1.5 text-[11px] font-black text-[#6E1418] mb-1"><i data-lucide="gem" class="w-3.5 h-3.5"></i> تفاصيل باقة الفرح</div>
                                        ${rows.map((r, i) => `<div class="flex justify-between ${i === rows.length - 1 ? 'font-black ' + remainingClass : 'text-slate-600'}"><span>${r[0]}</span><span class="font-bold">${escapeHtml(String(r[1]))}</span></div>`).join('')}
                                        ${menuHtml}
                                    </div>`;
                                })()}

                                ${(() => {
                                    const bImages = getBookingImages(b);
                                    if (!bImages.length) return '';
                                    const thumbs = bImages.map((img, i) =>
                                        `<img src="${img.data}" onclick="openBookingImageLightbox('${b.id}', ${i})" class="w-14 h-14 rounded-lg object-cover border border-slate-200 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity shrink-0">`
                                    ).join('');
                                    return `<div class="mt-4">
                                        <div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 mb-2"><i data-lucide="image" class="w-3.5 h-3.5"></i> الصور (${bImages.length})</div>
                                        <div class="flex flex-wrap gap-2">${thumbs}</div>
                                    </div>`;
                                })()}
                                
                                <div class="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
                                    <div class="flex items-center gap-2 flex-wrap">
                                        <div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg">
                                            <i data-lucide="at-sign" class="w-3 h-3"></i> بواسطة: ${b.createdBy.split('@')[0]}
                                        </div>
                                        ${b.createdAt ? `<div class="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg"><i data-lucide="calendar-clock" class="w-3 h-3"></i> تاريخ الإنشاء: ${new Date(b.createdAt).toLocaleDateString('ar-EG', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</div>` : ''}
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                        ${(() => {
                                            const bLinks = getBookingLinks(b);
                                            if (bLinks.length === 0) return '';
                                            if (bLinks.length === 1) {
                                                return `<a href="${bLinks[0]}" target="_blank" class="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors border border-blue-100"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> المرفقات</a>`;
                                            }
                                            const items = bLinks.map((url, i) => `<a href="${url}" target="_blank" rel="noopener"><i data-lucide="external-link" class="w-3.5 h-3.5"></i> مرفق ${i + 1}</a>`).join('');
                                            return `<div class="relative attachment-dropdown-container flex-1 min-w-[110px]">
                                                <button type="button" data-attach-target="attach-dd-${b.id}" onclick="toggleAttachmentDropdown(this, event)" class="w-full inline-flex items-center justify-center gap-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-100 cursor-pointer">
                                                    <i data-lucide="paperclip" class="w-3.5 h-3.5"></i> المرفقات (${bLinks.length})
                                                </button>
                                                <div id="attach-dd-${b.id}" class="attachment-dropdown hidden">${items}</div>
                                            </div>`;
                                        })()}
                                        <button onclick="emailBooking('${b.id}')" class="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1 text-xs font-bold text-emerald-700 hover:text-white hover:bg-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors border border-emerald-100">
                                            <i data-lucide="mail" class="w-3.5 h-3.5"></i> إرسال بالبريد
                                        </button>
                                        <button onclick="shareBooking('${b.id}')" class="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1 text-xs font-bold text-teal-700 hover:text-white hover:bg-teal-600 bg-teal-50 px-3 py-1.5 rounded-lg transition-colors border border-teal-100">
                                            <i data-lucide="share-2" class="w-3.5 h-3.5"></i> مشاركة
                                        </button>
                                        <button onclick="printSingleBooking('${b.id}')" class="flex-1 min-w-[110px] inline-flex items-center justify-center gap-1 text-xs font-bold text-[#6E1418] hover:text-white hover:bg-[#6E1418] bg-[#6E1418]/5 px-3 py-1.5 rounded-lg transition-colors border border-[#6E1418]/10">
                                            <i data-lucide="printer" class="w-3.5 h-3.5"></i> طباعة تفاصيل الحجز
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        ${canControl ? `
                            <div class="mt-5 pt-4 border-t border-slate-100 flex gap-3">
                                <button onclick="editBooking('${b.id}')" class="flex-1 px-5 py-2 text-sm font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-xl hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm">
                                    <i data-lucide="edit-3" class="w-4 h-4"></i> تعديل الحجز
                                </button>
                                <button onclick="deleteBooking('${b.id}')" class="flex-1 px-5 py-2 text-sm font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl hover:bg-red-600 hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i> إلغاء الحجز
                                </button>
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('');
            
            if(typeof lucide!=="undefined") lucide.createIcons();
            modal.classList.remove('hidden');
        }

        function toggleBookingDetailsVisibility(id) {
            if (state.currentUserEmail !== ADMIN_EMAIL) return;
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;
            booking.detailsHidden = !booking.detailsHidden;
            booking._isDirty = true;
            saveLocal();
            showToast(booking.detailsHidden ? '✅ تم إخفاء تفاصيل هذا الحجز عن باقي المستخدمين' : '✅ تم إظهار تفاصيل هذا الحجز لجميع المستخدمين', 'success');
            const title = document.getElementById('modalDateTitle');
            if (title && title.dataset.date) showDayDetails(title.dataset.date);
        }

        function closeDetailsModal() {
            document.getElementById('detailsModal').classList.add('hidden');
            cleanupAttachmentDropdowns();
        }

        function printSingleBooking(bookingId) {
            const b = state.bookings.find(x => x.id == bookingId || x.id === bookingId);
            if (!b) {
                showToast('لم يتم العثور على بيانات الحجز', 'error');
                return;
            }

            const hall = HALLS.find(h => h.id === b.hallId) || { name: b.hallId || 'غير معروف' };

            // Determine actual range from group (similar logic to upcoming bookings print)
            let startDate = b.startDate, endDate = b.endDate || b.startDate;
            if (b.originalRange && b.originalRange.includes(' to ')) {
                const p = b.originalRange.split(' to ');
                startDate = p[0]; endDate = p[1];
            } else {
                const gKey = b.groupId || b.id.toString().split('_d')[0];
                const groupDays = state.bookings
                    .filter(x => (x.groupId === gKey) || (x.id === gKey))
                    .map(x => x.startDate).sort();
                if (groupDays.length > 0) {
                    startDate = groupDays[0];
                    endDate   = groupDays[groupDays.length - 1];
                }
            }

            const fmtDate = d => d ? d.split('-').reverse().join('/') : '-';
            const displayDateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const prettyStart = startDate ? new Date(startDate).toLocaleDateString('ar-EG', displayDateOptions) : '-';
            const prettyEnd = endDate ? new Date(endDate).toLocaleDateString('ar-EG', displayDateOptions) : '-';

            const dateRow = (startDate !== endDate)
                ? `${prettyStart} <span style="color:#A88A45; font-weight:900;">←</span> ${prettyEnd}`
                : prettyStart;

            const timeDisplay = (b.startTime && b.endTime)
                ? `${b.startTime} – ${b.endTime}`
                : (b.startTime || 'يوم كامل');

            const printDate = new Date().toLocaleDateString('ar-EG', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            const notesDisplay = (b.notes || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const createdAtDisplay = b.createdAt
                ? new Date(b.createdAt).toLocaleDateString('ar-EG', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
                : '-';
            const escName  = (b.companyName || '-').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const escPhone = (b.phone || '-').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const escHall  = (hall.name || '-').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const acknowledgmentHtml = (b.eventType === 'wedding') ? `
<div class="ack-box">
    <div class="ack-title">تعهد و إقرار</div>
    <div class="ack-line">أتعهد أنا: <strong>${escName}</strong></div>
    <div class="ack-line">تليفون رقم: <strong>${escPhone}</strong></div>
    <div class="ack-text">
        * حمام السباحة آخر موعد لانتهاء الحفل الساعة الثانية عشر منتصف الليل، ويتم غلق الصوت تماماً على حمام السباحة في تمام الساعة الثانية عشر منتصف الليل، بدون أدنى مسؤولية للفندق عن التأخير في بدء الحفل.<br>
        * ميعاد استلام الغرف الطبيعي الساعة الثانية ظهراً، ويتم تسليم الغرف قبل الموعد في حالة وجود إمكانية.<br>
        كما إنني مسؤول مسؤولية كاملة وقانونية أمام جميع الجهات المختصة بعدم إطلاق الألعاب النارية بجميع أنواعها والطلقات النارية أو الصوت داخل محيط الفندق وموقف السيارات الخاص بالفندق، وذلك خلال الحفل المقام بفندق رستا بورسعيد.<br>
        كما أن الفندق غير مسؤول عن تغير الأحوال الجوية وقت الحفل حيث أنه لا يوجد بديل.<br>
        يتم الالتزام بعدد الأشخاص المتفق عليها في الحضور، وفي حالة حضور أفراد إضافية يتم احتساب الفرد بقيمة الوجبة المتفق عليها في الحفل للفرد حتى وإن لم تُقدَّم الوجبة.<br>
        * تعاقد الاستديو: الفندق ما هو إلا وسيط، وأي نزاع يكون بين العميل والاستديو الفندق ليس طرفاً فيه. للعميل الحرية في تغيير الاستديو أو أي من المتعهدين عدا متعهد الفنانين وخصم قيمتهم والتعاقد بمعرفته.<br>
        مقدم حجز 40% من قيمة الحفل لا ترد في حالة الإلغاء، ويسدد باقي الحساب قبل الحفل بيومين، ويعتبر الحفل لاغياً في حالة عدم سداد المبلغ كاملاً.<br>
        ممنوع منعاً باتاً إحضار أي مأكولات أو مشروبات من خارج الفندق.<br>
        استلمت نسخة وأوافق على ما بها من اشتراطات وتعليمات، وإنني مسؤول مسؤولية كاملة وقانونية أمام جميع الجهات المختصة.
    </div>
    <div class="ack-line">بقاعة: <strong>${escHall}</strong></div>
    <div class="ack-line">بتاريخ: <strong>${dateRow}</strong></div>
    <div class="ack-sign">التوقيع: <span class="sig-line"></span></div>
</div>` : '';

            const rows = [
                [b.eventType === 'wedding' ? 'الاسم' : 'الشركة / الجهة', b.companyName || '-'],
                ['القاعة', hall.name],
                ['التاريخ', dateRow],
                ['الوقت', timeDisplay],
                ['رقم الهاتف', b.phone || 'لا يوجد رقم'],
                ['تم الإنشاء بواسطة', (b.createdBy || '-').split('@')[0]],
                ['تاريخ الإنشاء', createdAtDisplay],
            ];

            weddingSummaryRows(b, { hideRoomsExtra: true }).forEach(r => rows.push(r));

            const printLinks = getBookingLinks(b);
            if (printLinks.length) {
                const linksHtml = printLinks.map((url, i) =>
                    `<div>${printLinks.length > 1 ? `مرفق ${i + 1}: ` : ''}<a href="${url}" target="_blank" style="color:#1d4ed8; font-weight:700;">${url}</a></div>`
                ).join('');
                rows.push(['روابط المرفقات', linksHtml]);
            }

            const rowsHtml = rows.map(r => `
                <tr>
                    <td class="label">${r[0]}</td>
                    <td class="value">${r[1]}</td>
                </tr>
            `).join('');

            const printHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>تفاصيل الحجز – ${(b.companyName || '').replace(/</g,'&lt;')}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Noto Sans Arabic', sans-serif;
        background: #ffffff;
        color: #1e293b;
        direction: rtl;
        padding: 8px 16px;
        font-size: 11px;
        line-height: 1.15;
    }
    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
        padding-bottom: 5px;
        border-bottom: 2px solid #6E1418;
    }
    .logo-area { display: flex; align-items: center; gap: 10px; }
    .logo-box {
        width: 30px; height: 30px;
        background: linear-gradient(135deg, #6E1418, #8a1c22);
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 15px; font-weight: 900;
    }
    .hotel-name { font-size: 14px; font-weight: 900; color: #6E1418; line-height: 1.2; }
    .hotel-sub { font-size: 9px; color: #94a3b8; font-weight: 600; margin-top: 0px; }
    .meta-area { text-align: left; }
    .print-date-label { font-size: 9.5px; color: #94a3b8; font-weight: 600; }
    .print-date-val { font-size: 11.5px; font-weight: 700; color: #475569; margin-top: 1px; }
    .doc-title {
        font-size: 12.5px; font-weight: 900;
        color: #334155;
        margin-bottom: 5px;
        display: flex; align-items: center; gap: 8px;
    }
    .doc-title::before {
        content: '';
        display: inline-block;
        width: 4px; height: 14px;
        background: #A88A45;
        border-radius: 4px;
    }
    .company-banner {
        background: linear-gradient(135deg, #6E1418, #8a1c22);
        color: #fff;
        border-radius: 12px;
        padding: 5px 14px;
        margin-bottom: 6px;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .company-banner .cb-label { font-size: 9.5px; opacity: 0.75; font-weight: 700; letter-spacing: 0.4px; }
    .company-banner .cb-value { font-size: 14px; font-weight: 900; color: #fff; }
    .company-banner .cb-hall { font-size: 9.5px; font-weight: 700; color: #A88A45; margin-top: 1px; }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10.5px;
        border: 1px solid #f1f5f9;
        border-radius: 8px;
        overflow: hidden;
    }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:nth-child(even) { background: #fafafa; }
    td.label {
        padding: 2.5px 12px;
        font-weight: 800;
        color: #6E1418;
        width: 140px;
        background: #fdf6f2;
        white-space: nowrap;
        border-right: 3px solid #A88A45;
        line-height: 1.25;
    }
    td.value {
        padding: 2.5px 12px;
        color: #334155;
        font-weight: 600;
        line-height: 1.25;
    }
    ${notesDisplay ? `
    .notes-box {
        margin-top: 5px;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 8px;
        padding: 4px 12px;
    }
    .notes-box .nb-title { font-size: 9.5px; font-weight: 900; color: #92400e; margin-bottom: 2px; }
    .notes-box .nb-text { font-size: 10.5px; color: #78350f; font-weight: 600; line-height: 1.25; white-space: pre-wrap; }
    ` : ''}
    ${acknowledgmentHtml ? `
    .ack-box {
        margin-top: 5px;
        background: #fafafa;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 6px 12px;
    }
    .ack-title {
        font-size: 11px; font-weight: 900; color: #6E1418;
        text-align: center;
        margin-bottom: 4px;
        padding-bottom: 3px;
        border-bottom: 1px solid #e2e8f0;
    }
    .ack-line { font-size: 10px; color: #334155; font-weight: 700; margin-bottom: 2px; }
    .ack-line strong { color: #6E1418; }
    .ack-text { font-size: 9px; color: #475569; font-weight: 500; line-height: 1.35; text-align: justify; margin: 3px 0; }
    .ack-sign { font-size: 10px; color: #334155; font-weight: 700; margin-top: 6px; display: flex; align-items: center; gap: 6px; }
    .ack-sign .sig-line { display: inline-block; width: 160px; border-bottom: 1px solid #94a3b8; height: 12px; }
    ` : ''}
    .footer {
        margin-top: 6px;
        padding-top: 4px;
        border-top: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        font-size: 8.5px;
        color: #94a3b8;
        font-weight: 600;
    }
    @media print {
        body { padding: 0; }
        @page { size: A4 portrait; margin: 6mm 9mm; }
        .company-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        td.label { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
</style>
</head>
<body>
<div class="page-header">
    <div class="logo-area">
        <div class="logo-box">R</div>
        <div>
            <div class="hotel-name">رستا بورسعيد</div>
            <div class="hotel-sub">Resta Port Said Hotel</div>
        </div>
    </div>
    <div class="meta-area">
        <div class="print-date-label">تاريخ الطباعة</div>
        <div class="print-date-val">${printDate}</div>
    </div>
</div>
<div class="doc-title">تفاصيل الحجز</div>
<div class="company-banner">
    <div class="cb-label">${b.eventType === 'wedding' ? 'الاسم' : 'الشركة / الجهة'}</div>
    <div class="cb-value">${(b.companyName || '-').replace(/</g,'&lt;')}</div>
    <div class="cb-hall">${hall.name}</div>
</div>
<table>
    <tbody>${rowsHtml}</tbody>
</table>
${notesDisplay ? `
<div class="notes-box">
    <div class="nb-title">ملاحظات</div>
    <div class="nb-text">${notesDisplay}</div>
</div>
` : ''}
${acknowledgmentHtml}
<div class="footer">
    <span>نظام إدارة حجوزات رستا – Resta Events Booking System</span>
    <span>${printDate}</span>
</div>
<script>
    window.onload = function() {
        setTimeout(function() { window.print(); }, 600);
    };
<\/script>
</body>
</html>`;

            const win = window.open('', '_blank', 'width=900,height=750,scrollbars=yes');
            if (!win) {
                showToast('يرجى السماح بفتح النوافذ المنبثقة في المتصفح', 'error');
                return;
            }
            win.document.write(printHtml);
            win.document.close();
        }

        // --- Email Booking Details ---
        const BOOKING_EMAIL_RECIPIENTS = [
            'Ayman.Eltabey@restahotels.com',
            'islam.farhood@restahotels.com',
            'Metwally.Khalil@restahotels.com',
            'mohamed.zaki@restahotels.com',
            'waleed.fahmy@restahotels.com',
            'mohamed.asalam@restahotels.com'
        ];

        function emailBooking(bookingId) {
            const b = state.bookings.find(x => x.id == bookingId || x.id === bookingId);
            if (!b) {
                showToast('لم يتم العثور على بيانات الحجز', 'error');
                return;
            }

            const hall = HALLS.find(h => h.id === b.hallId) || { name: b.hallId || 'غير معروف' };

            // تحديد نطاق التاريخ الفعلي (بنفس منطق الطباعة)
            let startDate = b.startDate, endDate = b.endDate || b.startDate;
            if (b.originalRange && b.originalRange.includes(' to ')) {
                const p = b.originalRange.split(' to ');
                startDate = p[0]; endDate = p[1];
            } else {
                const gKey = b.groupId || b.id.toString().split('_d')[0];
                const groupDays = state.bookings
                    .filter(x => (x.groupId === gKey) || (x.id === gKey))
                    .map(x => x.startDate).sort();
                if (groupDays.length > 0) {
                    startDate = groupDays[0];
                    endDate   = groupDays[groupDays.length - 1];
                }
            }

            const fmtDate = d => d ? d.split('-').reverse().join('/') : '-';
            const dateRow = (startDate !== endDate)
                ? `${fmtDate(startDate)} إلى ${fmtDate(endDate)}`
                : fmtDate(startDate);

            const timeDisplay = (b.startTime && b.endTime)
                ? `${b.startTime} - ${b.endTime}`
                : (b.startTime || 'يوم كامل');

            const createdAtDisplay = b.createdAt
                ? new Date(b.createdAt).toLocaleDateString('ar-EG', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
                : '-';

            // بدون أسعار — سيتم إرفاق ملف PDF بالأسعار يدويًا مع البريد (من زر الطباعة)
            const lines = [
                'تفاصيل الحجز - رستا بورسعيد',
                '----------------------------------------',
                `الشركة / الجهة: ${b.companyName || '-'}`,
                `القاعة: ${hall.name}`,
                `التاريخ: ${dateRow}`,
                `الوقت: ${timeDisplay}`,
                `الموظف المسؤول: ${b.employee || 'غير محدد'}`,
                `رقم الهاتف: ${b.phone || 'لا يوجد رقم'}`,
                `تم الإنشاء بواسطة: ${(b.createdBy || '-').split('@')[0]}`,
                `تاريخ الإنشاء: ${createdAtDisplay}`,
            ];

            if (b.eventType === 'wedding' && b.wedding) {
                lines.push('', '-- تفاصيل باقة الفرح --', ...weddingSummaryLines(b, { excludePrices: true }));
            }

            if (b.notes) {
                lines.push('', `ملاحظات: ${b.notes}`);
            }

            const emailLinks = getBookingLinks(b);
            if (emailLinks.length) {
                lines.push('', emailLinks.length > 1 ? 'مرفقات (روابط):' : 'مرفقات (رابط):');
                emailLinks.forEach((url, i) => lines.push(emailLinks.length > 1 ? `${i + 1}. ${url}` : url));
            }

            const subject = `تفاصيل الحجز - ${b.companyName || ''} - ${hall.name}`;
            const body = lines.join('\n');
            const mailtoUrl = `mailto:${BOOKING_EMAIL_RECIPIENTS.join(';')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = mailtoUrl;
        }

        // بناء نص تفاصيل الحجز (نفس محتوى إرسال البريد) لاستخدامه في المشاركة
        function buildBookingShareText(b) {
            const hall = HALLS.find(h => h.id === b.hallId) || { name: b.hallId || 'غير معروف' };

            let startDate = b.startDate, endDate = b.endDate || b.startDate;
            if (b.originalRange && b.originalRange.includes(' to ')) {
                const p = b.originalRange.split(' to ');
                startDate = p[0]; endDate = p[1];
            } else {
                const gKey = b.groupId || b.id.toString().split('_d')[0];
                const groupDays = state.bookings
                    .filter(x => (x.groupId === gKey) || (x.id === gKey))
                    .map(x => x.startDate).sort();
                if (groupDays.length > 0) {
                    startDate = groupDays[0];
                    endDate   = groupDays[groupDays.length - 1];
                }
            }

            const fmtDate = d => d ? d.split('-').reverse().join('/') : '-';
            const dateRow = (startDate !== endDate)
                ? `${fmtDate(startDate)} إلى ${fmtDate(endDate)}`
                : fmtDate(startDate);

            const timeDisplay = (b.startTime && b.endTime)
                ? `${b.startTime} - ${b.endTime}`
                : (b.startTime || 'يوم كامل');

            const createdAtDisplay = b.createdAt
                ? new Date(b.createdAt).toLocaleDateString('ar-EG', {year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})
                : '-';

            const lines = [
                'تفاصيل الحجز - رستا بورسعيد',
                '----------------------------------------',
                `الشركة / الجهة: ${b.companyName || '-'}`,
                `القاعة: ${hall.name}`,
                `التاريخ: ${dateRow}`,
                `الوقت: ${timeDisplay}`,
                `الموظف المسؤول: ${b.employee || 'غير محدد'}`,
                `رقم الهاتف: ${b.phone || 'لا يوجد رقم'}`,
                `تم الإنشاء بواسطة: ${(b.createdBy || '-').split('@')[0]}`,
                `تاريخ الإنشاء: ${createdAtDisplay}`,
            ];

            if (b.eventType === 'wedding' && b.wedding) {
                lines.push('', '-- تفاصيل باقة الفرح --', ...weddingSummaryLines(b));
            }

            if (b.notes) {
                lines.push('', `ملاحظات: ${b.notes}`);
            }

            const shareLinks = getBookingLinks(b);
            if (shareLinks.length) {
                lines.push('', shareLinks.length > 1 ? 'مرفقات (روابط):' : 'مرفقات (رابط):');
                shareLinks.forEach((url, i) => lines.push(shareLinks.length > 1 ? `${i + 1}. ${url}` : url));
            }

            return {
                title: `تفاصيل الحجز - ${b.companyName || ''} - ${hall.name}`,
                text: lines.join('\n')
            };
        }

        // نسخ تفاصيل الحجز مباشرة عند الضغط على أيقونة المشاركة
        function shareBooking(bookingId) {
            const b = state.bookings.find(x => x.id == bookingId || x.id === bookingId);
            if (!b) {
                showToast('لم يتم العثور على بيانات الحجز', 'error');
                return;
            }

            const { text } = buildBookingShareText(b);
            copyBookingText(text);
        }

        // نسخ النص إلى الحافظة مع بديل احتياطي للمتصفحات القديمة
        function copyBookingText(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text)
                    .then(() => showToast('تم نسخ تفاصيل الحجز، يمكنك لصقها في أي تطبيق', 'success'))
                    .catch(() => legacyCopyText(text));
            } else {
                legacyCopyText(text);
            }
        }

        function legacyCopyText(text) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) {
                    showToast('تم نسخ تفاصيل الحجز، يمكنك لصقها في أي تطبيق', 'success');
                } else {
                    showToast('تعذّر نسخ النص على هذا المتصفح', 'error');
                }
            } catch (e) {
                showToast('تعذّر نسخ النص على هذا المتصفح', 'error');
            }
        }

        function changeMonth(delta) {
            state.currentMonth += delta;
            if (state.currentMonth > 11) {
                state.currentMonth = 0;
                state.currentYear++;
            } else if (state.currentMonth < 0) {
                state.currentMonth = 11;
                state.currentYear--;
            }
            render();
        }

        function render() {
            const app = document.getElementById('app');
            app.innerHTML = `
                ${renderHeader()}
                <main class="max-w-7xl mx-auto p-4 md:p-8 pb-24 space-y-8">
                    ${renderDashboard()}
                </main>
            `;
            if(typeof lucide!=="undefined") lucide.createIcons();
        }

        function renderHeader() {
            return `
                <header class="glass-panel sticky top-0 z-40 border-b border-slate-200 shadow-sm">
                    <div class="max-w-7xl mx-auto px-2 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
                        


                        <div class="flex items-center gap-1 sm:gap-3 flex-nowrap justify-end">
                            ${!isGuest() ? `
                            <div class="flex items-center bg-slate-100 rounded-xl p-0.5 gap-0.5 shrink-0">
                                <button onclick="performUndo()" ${moveUndoStack.length === 0 ? 'disabled' : ''} class="p-1.5 sm:p-2 text-slate-500 hover:text-[#6E1418] hover:bg-white rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500" title="تراجع عن آخر نقل">
                                    <i data-lucide="undo-2" class="w-4 h-4 sm:w-5 sm:h-5"></i>
                                </button>
                                <button onclick="performRedo()" ${moveRedoStack.length === 0 ? 'disabled' : ''} class="p-1.5 sm:p-2 text-slate-500 hover:text-[#6E1418] hover:bg-white rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500" title="إعادة آخر نقل">
                                    <i data-lucide="redo-2" class="w-4 h-4 sm:w-5 sm:h-5"></i>
                                </button>
                            </div>

                            <button onclick="toggleNotificationsModal()" class="relative p-2 sm:p-2.5 text-slate-500 hover:text-[#6E1418] hover:bg-slate-100 rounded-xl transition-all shrink-0" title="الإشعارات">
                                <i data-lucide="bell" class="w-5 h-5"></i>
                                ${state.notifications.length > 0 ? '<span class="notification-dot animate-pulse"></span>' : ''}
                            </button>
                            ` : ''}

                            <!-- زر المزيد (موبايل فقط) -->
                            <div class="relative shrink-0 sm:hidden" id="moreMenuContainer">
                                <button onclick="toggleMoreMenu(event)" class="p-2 text-slate-500 hover:text-[#6E1418] hover:bg-slate-100 rounded-xl transition-all" title="المزيد">
                                    <i data-lucide="more-vertical" class="w-5 h-5"></i>
                                </button>
                                <div id="moreMenuDropdown" class="sync-dropdown hidden border border-slate-100">
                                    <button onclick="exportToExcel(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="file-spreadsheet" class="w-4 h-4 text-emerald-600"></i>
                                        </span>
                                        تصدير (Excel)
                                    </button>
                                    <button onclick="printUpcomingBookings(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="printer" class="w-4 h-4 text-violet-600"></i>
                                        </span>
                                        طباعة الحجوزات القادمة
                                    </button>
                                    ${!isGuest() ? `
                                    <button onclick="toggleDeletedBookingsModal(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="trash-2" class="w-4 h-4 text-red-600"></i>
                                        </span>
                                        الحجوزات المحذوفة
                                    </button>
                                    ` : ''}
                                    <button onclick="toggleArchiveModal(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="archive" class="w-4 h-4 text-[#A88A45]"></i>
                                        </span>
                                        الأرشيف
                                    </button>
                                    ${state.currentUserEmail === ADMIN_EMAIL ? `
                                    <button onclick="toggleQuickCalcModal(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="gem" class="w-4 h-4 text-[#6E1418]"></i>
                                        </span>
                                        حاسبة باقة فرح سريعة
                                    </button>
                                    ` : ''}
                                    ${state.currentUserEmail === ADMIN_EMAIL ? `
                                    <button onclick="toggleWeddingSettingsModal(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="settings-2" class="w-4 h-4 text-[#6E1418]"></i>
                                        </span>
                                        إعدادات باقات الأفراح
                                    </button>
                                    ` : ''}
                                    ${state.currentUserEmail === ADMIN_EMAIL ? `
                                    <button onclick="exportBackup(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="hard-drive-download" class="w-4 h-4 text-indigo-600"></i>
                                        </span>
                                        تصدير نسخة احتياطية
                                    </button>
                                    <button onclick="exportFullBackup(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="database-backup" class="w-4 h-4 text-indigo-600"></i>
                                        </span>
                                        تصدير نسخة كاملة (شاملة الأرشيف)
                                    </button>
                                    <button onclick="triggerImportBackup(); toggleMoreMenu()">
                                        <span class="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="hard-drive-upload" class="w-4 h-4 text-amber-600"></i>
                                        </span>
                                        استيراد نسخة احتياطية
                                    </button>
                                    ` : ''}
                                </div>
                            </div>

                            <button onclick="exportToExcel()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all shrink-0" title="تصدير (Excel)">
                                <i data-lucide="file-spreadsheet" class="w-5 h-5"></i>
                            </button>
                            <button onclick="printUpcomingBookings()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-violet-600 hover:bg-violet-50 rounded-xl transition-all shrink-0" title="طباعة الحجوزات القادمة">
                                <i data-lucide="printer" class="w-5 h-5"></i>
                            </button>
                            ${!isGuest() ? `
                            <button onclick="toggleDeletedBookingsModal()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all shrink-0" title="الحجوزات المحذوفة">
                                <i data-lucide="trash-2" class="w-5 h-5"></i>
                            </button>
                            ` : ''}
                            <button onclick="toggleArchiveModal()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-[#A88A45] hover:bg-amber-50 rounded-xl transition-all shrink-0" title="الأرشيف">
                                <i data-lucide="archive" class="w-5 h-5"></i>
                            </button>
                            ${state.currentUserEmail === ADMIN_EMAIL ? `
                            <button onclick="toggleQuickCalcModal()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-[#6E1418] hover:bg-pink-50 rounded-xl transition-all shrink-0" title="حاسبة باقة فرح سريعة">
                                <i data-lucide="gem" class="w-5 h-5"></i>
                            </button>
                            <button onclick="toggleWeddingSettingsModal()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-[#6E1418] hover:bg-pink-50 rounded-xl transition-all shrink-0" title="إعدادات باقات الأفراح">
                                <i data-lucide="settings-2" class="w-5 h-5"></i>
                            </button>
                            ` : ''}

                            <!-- زر الألعاب -->
                            <div class="relative shrink-0" id="gamesDropdownContainer">
                                <button onclick="toggleGamesMenu(event)" class="p-2 sm:p-2.5 text-slate-500 hover:text-[#A88A45] hover:bg-amber-50 rounded-xl transition-all" title="الألعاب">
                                    <i data-lucide="gamepad-2" class="w-5 h-5"></i>
                                </button>
                                <div id="gamesDropdown" class="sync-dropdown hidden border border-slate-100">
                                    <a href="https://salamam-art.github.io/RESTA-FB/pong.html" target="_blank" rel="noopener">
                                        <span class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="circle-dot" class="w-4 h-4 text-blue-600"></i>
                                        </span>
                                        Pong
                                    </a>
                                    <a href="https://salamam-art.github.io/RESTA-FB/snake.html" target="_blank" rel="noopener">
                                        <span class="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="dot" class="w-4 h-4 text-green-600"></i>
                                        </span>
                                        Snake
                                    </a>
                                    <a href="https://salamam-art.github.io/RESTA-FB/space-invaders.html" target="_blank" rel="noopener">
                                        <span class="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="rocket" class="w-4 h-4 text-purple-600"></i>
                                        </span>
                                        Space Invaders
                                    </a>
                                    <a href="https://salamam-art.github.io/RESTA-FB/solitaire.html" target="_blank" rel="noopener">
                                        <span class="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
                                            <i data-lucide="spade" class="w-4 h-4 text-red-600"></i>
                                        </span>
                                        Solitaire
                                    </a>
                                </div>
                            </div>
                            ${!isGuest() ? `
                            <!-- زر المزامنة -->
                            <div class="relative shrink-0 hidden sm:block" id="syncDropdownContainer">
                                <button onclick="syncToCloud()" class="p-2 sm:p-2.5 text-slate-500 hover:text-[#A88A45] hover:bg-amber-50 rounded-xl transition-all" title="مزامنة مع السحابة">
                                    <i data-lucide="refresh-cw" class="w-5 h-5 ${state.isSyncing ? 'animate-spin text-[#A88A45]' : ''}"></i>
                                </button>
                            </div>
                            ` : ''}
                            ${state.currentUserEmail === ADMIN_EMAIL ? `
                            <!-- زر تصدير نسخة احتياطية (أدمن فقط) -->
                            <button onclick="exportBackup()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all shrink-0" title="تصدير نسخة احتياطية (JSON)">
                                <i data-lucide="hard-drive-download" class="w-5 h-5"></i>
                            </button>
                            <!-- زر تصدير نسخة كاملة شاملة الأرشيف (أدمن فقط) -->
                            <button onclick="exportFullBackup()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all shrink-0" title="تصدير نسخة كاملة شاملة الأرشيف (JSON)">
                                <i data-lucide="database-backup" class="w-5 h-5"></i>
                            </button>
                            <!-- زر استيراد نسخة احتياطية (أدمن فقط) -->
                            <button onclick="triggerImportBackup()" class="hidden sm:inline-block p-2 sm:p-2.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl transition-all shrink-0" title="استيراد نسخة احتياطية (JSON)">
                                <i data-lucide="hard-drive-upload" class="w-5 h-5"></i>
                            </button>
                            ` : ''}

                            ${state.currentUserEmail === ADMIN_EMAIL ? `
                                <button onclick="toggleUsersModal()" class="p-2 sm:p-2.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all shrink-0" title="إدارة المستخدمين">
                                    <i data-lucide="users" class="w-5 h-5"></i>
                                </button>
                            ` : ''}

                            ${((window.PublicKeyCredential || hasAndroidBiometricBridge()) && state.currentUserEmail !== GUEST_EMAIL) ? `
                                <button onclick="toggleBiometricForCurrentUser()" class="p-2 sm:p-2.5 ${isBiometricRegisteredForCurrentUser() ? 'text-[#6E1418] bg-red-50' : 'text-slate-500 hover:text-[#6E1418] hover:bg-red-50'} rounded-xl transition-all shrink-0" title="${isBiometricRegisteredForCurrentUser() ? 'إلغاء الدخول بالبصمة' : 'تفعيل الدخول بالبصمة'}">
                                    <i data-lucide="fingerprint" class="w-5 h-5"></i>
                                </button>
                            ` : ''}

                            <div class="h-6 sm:h-8 w-px bg-slate-200 mx-0.5 sm:mx-2 shrink-0"></div>
                            
                            <button onclick="logout()" class="flex items-center gap-1 sm:gap-2 text-sm font-bold text-red-600 hover:bg-red-50 p-2 sm:px-4 sm:py-2 rounded-xl transition-all border border-transparent hover:border-red-100 shrink-0" title="خروج">
                                <span class="hidden sm:inline">خروج</span>
                                <i data-lucide="log-out" class="w-5 h-5"></i>
                            </button>
                        </div>
                    </div>
                </header>
            `;
        }

        function renderDashboard() {
            const totalBookings = state.bookings.length;
            const todayStr = new Date().toISOString().split('T')[0];
            const todayCount = state.bookings.filter(b => b.startDate === todayStr).length;
            const futureCount = state.bookings.filter(b => b.startDate >= todayStr).length;

            return `
                <!-- Summary Card -->
                <div class="bg-white rounded-[1.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row mb-2">
                    <div class="bg-gradient-to-br from-[#6E1418] to-[#8a1c22] p-6 text-white md:w-1/3 flex flex-col justify-center relative overflow-hidden">
                        <div class="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
                        <div class="absolute -left-8 -bottom-8 w-24 h-24 bg-[#A88A45]/30 rounded-full blur-xl"></div>
                        
                        <h2 class="text-xl font-black mb-1 relative z-10">${isGuest() ? 'زائر' : (state.currentUserEmail || 'زائر')}</h2>
                        <p class="text-sm text-white/70 mb-6 relative z-10 font-medium">إحصائيات الحجوزات لجميع القاعات</p>
                        
                        <div class="grid grid-cols-2 gap-4 relative z-10">
                            <div class="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
                                <p class="text-xs text-white/80 font-bold mb-1">إجمالي الحجوزات</p>
                                <p class="text-2xl font-black text-white">${totalBookings}</p>
                            </div>
                            <div class="bg-[#A88A45]/30 backdrop-blur-sm rounded-xl p-4 border border-[#A88A45]/50">
                                <p class="text-xs text-white/80 font-bold mb-1">حجوزات اليوم</p>
                                <p class="text-2xl font-black text-white">${todayCount}</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="flex-1 p-0 overflow-x-auto">
                        <table class="w-full text-sm text-right">
                            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                                <tr>
                                    <th class="px-6 py-4">القاعة</th>
                                    <th class="px-6 py-4 text-center">النسبة من الإجمالي</th>
                                    <th class="px-6 py-4 text-center">الإجمالي</th>
                                    <th class="px-6 py-4 text-center">القادمة</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100">
                                ${HALLS.map((hall) => {
                                    const total  = state.bookings.filter(b => b.hallId === hall.id).length;
                                    const future = state.bookings.filter(b => b.hallId === hall.id && b.startDate >= todayStr).length;
                                    const pct    = totalBookings > 0 ? Math.round((total / totalBookings) * 100) : 0;
                                    return `
                                        <tr class="hover:bg-slate-50/50 transition-colors">
                                            <td class="px-6 py-4 whitespace-nowrap">
                                                <div class="flex items-center gap-3">
                                                    <span class="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${hall.color}">
                                                        <i data-lucide="${hall.icon}" class="w-4 h-4"></i>
                                                    </span>
                                                    <span class="font-bold text-slate-700">${hall.name}</span>
                                                </div>
                                            </td>
                                            <td class="px-6 py-4 text-center w-1/3">
                                                <div class="flex items-center gap-3 justify-center">
                                                    <div class="w-full max-w-[120px] bg-slate-100 rounded-full h-2 overflow-hidden shadow-inner">
                                                        <div class="bg-[#6E1418] h-2 rounded-full transition-all duration-1000 ease-out" style="width: ${pct}%"></div>
                                                    </div>
                                                    <span class="text-xs font-bold text-slate-400 w-8">${pct}%</span>
                                                </div>
                                            </td>
                                            <td class="px-6 py-4 text-center font-black text-slate-700">${total}</td>
                                            <td class="px-6 py-4 text-center font-black text-emerald-600">${future}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <button onclick="toggleBookingsListModal()" class="w-full bg-white border border-slate-200 text-slate-700 p-4 rounded-2xl shadow-sm hover:shadow-md hover:border-[#A88A45] hover:text-[#6E1418] transition-all flex items-center justify-center gap-3 font-bold text-lg group">
                    <i data-lucide="list-video" class="w-6 h-6 text-slate-400 group-hover:text-[#A88A45] transition-colors"></i>
                    <span>عرض جدول الحجوزات القادمة بالتفصيل</span>
                    <i data-lucide="arrow-left" class="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 group-hover:-translate-x-2 transition-all"></i>
                </button>

                <div class="bg-white rounded-[2rem] shadow-sm border border-slate-200 p-6 md:p-8 mt-6">
                    <div class="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-[#A88A45]/10 rounded-xl flex items-center justify-center text-[#A88A45]">
                                <i data-lucide="calendar" class="w-5 h-5"></i>
                            </div>
                            <h2 class="text-2xl font-black text-[#6E1418] tracking-tight">التقويم الشهري</h2>
                        </div>
                        <div class="flex bg-slate-50 border border-slate-200 rounded-xl p-1.5 shadow-sm">
                            <button onclick="changeMonth(-1)" ondragover="handleMonthNavDragOver(event, -1)" ondragleave="handleMonthNavDragLeave(event)" data-month-nav="-1" class="p-2 hover:bg-white rounded-lg shadow-sm hover:shadow text-slate-600 hover:text-[#6E1418] transition-all"><i data-lucide="chevron-right" class="w-5 h-5"></i></button>
                            <span class="px-6 py-2 text-base font-black text-[#6E1418] flex items-center min-w-[140px] justify-center tracking-wide">
                                ${new Date(state.currentYear, state.currentMonth).toLocaleString('ar-EG', { month: 'long', year: 'numeric' })} (شهر ${state.currentMonth + 1})
                            </span>
                            <button onclick="changeMonth(1)" ondragover="handleMonthNavDragOver(event, 1)" ondragleave="handleMonthNavDragLeave(event)" data-month-nav="1" class="p-2 hover:bg-white rounded-lg shadow-sm hover:shadow text-slate-600 hover:text-[#6E1418] transition-all"><i data-lucide="chevron-left" class="w-5 h-5"></i></button>
                        </div>
                    </div>
                    ${renderCalendar(true)}
                </div>
            `;
        }

        function renderCalendar(isDashboard) {
            const year = state.currentYear;
            const month = state.currentMonth;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const firstDayIndex = new Date(year, month, 1).getDay();
            const paddingDays = (firstDayIndex + 1) % 7;
            const days = [];

            // MAX_VISIBLE: الحد الأقصى لعدد الحجوزات المعروضة في كل خلية
            // بناءً على ارتفاع الخلية (150px): header≈32px, كل tag≈25px → (150-32)/25 ≈ 4
            const MAX_VISIBLE = 4;

            for (let i = 0; i < paddingDays; i++) {
                days.push('<div class="rounded-xl bg-transparent" style="height:150px;"></div>');
            }

            for (let i = 1; i <= daysInMonth; i++) {
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
                let dayBookings = state.bookings.filter(b => b.startDate === dateStr);
                
                if (!isDashboard) {
                    dayBookings = dayBookings.filter(b => b.hallId === state.selectedHall.id);
                }
                
                dayBookings.sort((a, b) => {
                    if (!a.startTime) return -1;
                    if (!b.startTime) return 1;
                    return a.startTime.localeCompare(b.startTime);
                });

                const totalCount = dayBookings.length;
                const visibleBookings = dayBookings.slice(0, MAX_VISIBLE);
                const hiddenCount = totalCount - visibleBookings.length;

                const tagsHtml = visibleBookings.map(b => {
                    const hall = HALLS.find(h => h.id === b.hallId);
                    const isMyBooking = b.createdBy === state.currentUserEmail;
                    const canDrag = !isGuest() && (state.currentUserEmail === ADMIN_EMAIL || isMyBooking);
                    return `
                        <div class="booking-tag ${hall.color} ${hall.border} ${isMyBooking ? 'my-booking' : ''}"
                             title="${hall.name}: ${escapeHtml(b.companyName)}${canDrag ? ' (اسحب لنقل الحجز ليوم آخر)' : ''}"
                             draggable="${canDrag}"
                             ondragstart="${canDrag ? `handleBookingDragStart(event, '${b.id}')` : ''}"
                             ondragend="${canDrag ? 'handleBookingDragEnd(event)' : ''}"
                             ontouchstart="${canDrag ? `handleBookingTouchStart(event, '${b.id}')` : ''}"
                             ontouchmove="${canDrag ? 'handleBookingTouchMove(event)' : ''}"
                             ontouchend="${canDrag ? 'handleBookingTouchEnd(event)' : ''}"
                             ontouchcancel="${canDrag ? 'handleBookingTouchCancel(event)' : ''}">
                            <div class="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" style="min-width:6px;"></div>
                            <span>${b.eventType === 'wedding' ? '💍 ' : ''}${escapeHtml(b.companyName)}</span>
                        </div>
                    `;
                }).join('');

                const moreHtml = hiddenCount > 0
                    ? `<div class="more-bookings-btn" onclick="event.stopPropagation(); showDayDetails('${dateStr}')" title="عرض جميع الحجوزات">+${hiddenCount} المزيد</div>`
                    : '';

                const isToday = new Date().toISOString().split('T')[0] === dateStr;
                days.push(`
                    <div onclick="handleDayClick('${dateStr}')"
                         ondragover="handleDayDragOver(event)"
                         ondragleave="handleDayDragLeave(event)"
                         ondrop="handleDayDrop(event, '${dateStr}')"
                         data-date="${dateStr}"
                         class="day-cell ${isToday ? 'today-active z-10' : ''} cursor-pointer group">
                        <div class="flex items-center justify-between mb-1" style="flex-shrink:0;">
                            <span class="text-sm font-black w-7 h-7 flex items-center justify-center rounded-lg ${isToday ? 'bg-[#6E1418] text-white' : 'text-slate-500 group-hover:bg-slate-100 transition-colors'}">${i}</span>
                            ${totalCount > 0 ? `<span class="text-[10px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">${totalCount}</span>` : ''}
                        </div>
                        <div class="day-bookings-container">
                            ${tagsHtml}
                            ${moreHtml}
                        </div>
                    </div>
                `);
            }

            const weekDays = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
            return `
                <div class="calendar-scroll-wrapper">
                    <div class="calendar-fixed-width calendar-wrapper">
                        <div class="calendar-header-row">
                            ${weekDays.map(d => `<div>${d}</div>`).join('')}
                        </div>
                        <div class="calendar-grid shadow-inner border border-slate-100">
                            ${days.join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // ─── قائمة المزيد (موبايل) ──────────────────────────────────────
        function toggleMoreMenu(e) {
            if (e) e.stopPropagation();
            const dd = document.getElementById('moreMenuDropdown');
            if (dd) dd.classList.toggle('hidden');
        }

        function toggleGamesMenu(e) {
            if (e) e.stopPropagation();
            const dd = document.getElementById('gamesDropdown');
            if (dd) dd.classList.toggle('hidden');
        }

        // ─── Calendar Day Click Handler ───────────────────────────────────
        function handleDayClick(dateStr) {
            let dayBookings = state.bookings.filter(b => b.startDate === dateStr);
            if (state.view !== 'dashboard' && state.selectedHall) {
                dayBookings = dayBookings.filter(b => b.hallId === state.selectedHall.id);
            }
            if (dayBookings.length === 0) {
                openNewBookingForDate(dateStr);
            } else {
                showDayDetails(dateStr);
            }
        }

        // ─── Open New Booking Modal Pre-filled for a Specific Date ───────
        function openNewBookingForDate(dateStr) {
            if (isGuest()) return;
            if (state.currentUserEmail !== ADMIN_EMAIL && isPastDateStr(dateStr)) {
                showToast('لا يمكن إضافة حجوزات في الأيام المنصرمة.', 'error');
                return;
            }
            state.editingBookingId = null;

            // القاعة تُحذف من القائمة فقط إذا كانت محجوزة يوم كامل (بدون توقيت)
            // أما إذا كانت محجوزة بوقت محدد فتظهر في القائمة ويتم التحقق من التعارض عند الحفظ
            const fullDayBookedHallIds = state.bookings
                .filter(b => b.startDate === dateStr && (!b.startTime || !b.endTime))
                .map(b => b.hallId);
            const availableHalls = HALLS.filter(h => !fullDayBookedHallIds.includes(h.id));

            if (availableHalls.length === 0) {
                showToast('جميع القاعات محجوزة بشكل كامل في هذا اليوم', 'error');
                return;
            }

            const modal  = document.getElementById('globalBookingModal');
            const select = document.getElementById('globalHallSelect');
            const form   = document.getElementById('globalBookingForm');

            // عرض القاعات المتاحة فقط
            select.innerHTML = '<option value="">-- يرجى تحديد القاعة --</option>' +
                availableHalls.map(h => '<option value="' + h.id + '">' + h.name + '</option>').join('');

            form.reset();
            select.value = '';
            form.querySelector('input[name="dateFrom"]').value = dateStr;
            form.querySelector('input[name="dateTo"]').value   = dateStr;
            form.querySelector('input[name="employee"]').value = getDefaultEmployeeName();
            document.getElementById('globalEventType').value = 'normal';
            document.getElementById('weddingCalcSection').classList.add('hidden');
            fillWeddingFormFromBooking(null);

            // إظهار قسم "نوع الحجز" للأدمن فقط
            const bookingTypeSection = document.getElementById('bookingTypeSection');
            if (bookingTypeSection) {
                if (state.currentUserEmail === ADMIN_EMAIL) {
                    bookingTypeSection.classList.remove('hidden');
                } else {
                    bookingTypeSection.classList.add('hidden');
                    document.getElementById('globalEventType').value = 'normal';
                    document.getElementById('weddingCalcSection').classList.add('hidden');
                }
            }

            form.querySelector('button[type="submit"]').innerHTML =
                '<i data-lucide="check-circle" class="w-6 h-6 text-[#A88A45]"></i><span>حفظ بيانات الحجز</span>';

            const titleEl = document.getElementById('globalModalTitle');
            if (titleEl) titleEl.textContent = 'حجز جديد';

            // إغلاق نافذة التفاصيل إن كانت مفتوحة
            document.getElementById('detailsModal').classList.add('hidden');

            modal.classList.remove('hidden');
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        // ─── Attachment Links (multi-link support) ─────────────────────────
        function addLinkField(value) {
            const container = document.getElementById('linksContainer');
            if (!container) return;
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2';
            row.innerHTML =
                '<input type="url" name="links[]" placeholder="https://..." dir="ltr" class="text-left flex-1">' +
                '<button type="button" onclick="removeLinkField(this)" class="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="حذف الرابط"><i data-lucide="x" class="w-4 h-4"></i></button>';
            container.appendChild(row);
            if (typeof value === 'string') row.querySelector('input').value = value;
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function removeLinkField(btn) {
            const container = document.getElementById('linksContainer');
            if (!container) return;
            const row = btn.closest('div');
            // Keep at least one (empty) row so the user always has a field to type into
            if (container.children.length <= 1) {
                row.querySelector('input').value = '';
                return;
            }
            row.remove();
        }

        // Resets the links container back to a single empty field, then fills it
        // with the given links (adding extra rows as needed). Falls back to the
        // legacy single "link" field for bookings saved before this feature.
        function setLinksInForm(links) {
            const container = document.getElementById('linksContainer');
            if (!container) return;
            container.innerHTML =
                '<div class="flex items-center gap-2">' +
                '<input type="url" name="links[]" placeholder="https://..." dir="ltr" class="text-left flex-1">' +
                '<button type="button" onclick="removeLinkField(this)" class="shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="حذف الرابط"><i data-lucide="x" class="w-4 h-4"></i></button>' +
                '</div>';
            const list = (links && links.length) ? links : [''];
            container.querySelector('input').value = list[0] || '';
            for (let i = 1; i < list.length; i++) addLinkField(list[i]);
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function getLinksFromForm(form) {
            return Array.from(form.querySelectorAll('input[name="links[]"]'))
                .map(inp => inp.value.trim())
                .filter(Boolean);
        }

        // Returns the attachment links of a booking, supporting both the new
        // "links" array and the legacy single "link" string field.
        function getBookingLinks(b) {
            if (Array.isArray(b.links) && b.links.length) return b.links;
            if (b.link) return [b.link];
            return [];
        }

        // ─── Booking Images: upload, camera capture, resize/compress, lightbox ──
        let formImages = [];           // {id, data} images attached to the currently open booking form
        let lightboxImages = [];       // images shown in the current lightbox session
        let lightboxIndex = 0;

        const IMAGE_MAX_DIMENSION = 1280; // px, longest side after resize
        const IMAGE_JPEG_QUALITY  = 0.72;

        function genImageId() {
            return 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        }

        // Returns the images of a booking as a normalized {id, data} array.
        function getBookingImages(b) {
            if (!b || !Array.isArray(b.images)) return [];
            return b.images.map(img => (typeof img === 'string') ? { id: genImageId(), data: img } : img).filter(img => img && img.data);
        }

        // Resizes/compresses an image File (or a raw dataURL) down to IMAGE_MAX_DIMENSION
        // on its longest side and re-encodes it as JPEG to keep the payload small,
        // since every save re-uploads the full bookings tree to Firebase.
        function resizeImageSource(source) {
            return new Promise((resolve, reject) => {
                const finish = (dataUrl) => {
                    const img = new Image();
                    img.onload = () => {
                        let { width, height } = img;
                        if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
                            if (width >= height) {
                                height = Math.round(height * (IMAGE_MAX_DIMENSION / width));
                                width  = IMAGE_MAX_DIMENSION;
                            } else {
                                width  = Math.round(width * (IMAGE_MAX_DIMENSION / height));
                                height = IMAGE_MAX_DIMENSION;
                            }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY));
                    };
                    img.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
                    img.src = dataUrl;
                };
                if (typeof source === 'string') {
                    finish(source);
                } else {
                    const reader = new FileReader();
                    reader.onload = () => finish(reader.result);
                    reader.onerror = () => reject(new Error('تعذّرت قراءة الملف'));
                    reader.readAsDataURL(source);
                }
            });
        }

        function triggerImageFileInput() {
            const input = document.getElementById('imageFileInput');
            if (input) input.click();
        }

        async function handleImageFilesSelected(event) {
            const files = Array.from(event.target.files || []).filter(f => f.type.startsWith('image/'));
            for (const file of files) {
                try {
                    const dataUrl = await resizeImageSource(file);
                    formImages.push({ id: genImageId(), data: dataUrl });
                } catch (err) {
                    alert('تعذّر تحميل إحدى الصور: ' + err.message);
                }
            }
            event.target.value = ''; // allow re-selecting the same file
            renderImageThumbs();
        }

        function setFormImages(images) {
            formImages = getBookingImages({ images: images || [] });
            renderImageThumbs();
        }

        function removeFormImage(id) {
            formImages = formImages.filter(img => img.id !== id);
            renderImageThumbs();
        }

        function renderImageThumbs() {
            const container = document.getElementById('imageThumbsContainer');
            if (!container) return;
            container.innerHTML = formImages.map((img, i) => `
                <div class="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shadow-sm group shrink-0">
                    <img src="${img.data}" onclick="openImageLightbox(formImages.map(x=>x.data), ${i})" class="w-full h-full object-cover cursor-zoom-in">
                    <button type="button" onclick="removeFormImage('${img.id}')" title="حذف الصورة"
                        class="absolute top-1 left-1 w-6 h-6 flex items-center justify-center rounded-full bg-red-600/90 text-white shadow hover:bg-red-700 transition-colors">
                        <i data-lucide="x" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            `).join('') || '<p class="text-xs text-slate-400">لا توجد صور مرفقة بعد</p>';
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        // ─── Image lightbox (used both from the form and from the booking details card) ──
        // Looks up a booking by id at click-time so thumbnails don't need to embed
        // the full image list (which can be large) in the HTML.
        function openBookingImageLightbox(bookingId, index) {
            const booking = state.bookings.find(b => b.id === bookingId);
            if (!booking) return;
            openImageLightbox(getBookingImages(booking).map(img => img.data), index);
        }

        function openImageLightbox(images, index) {
            lightboxImages = images || [];
            lightboxIndex = index || 0;
            if (!lightboxImages.length) return;
            renderLightbox();
            document.getElementById('imageLightbox').classList.remove('hidden');
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function renderLightbox() {
            document.getElementById('lightboxImg').src = lightboxImages[lightboxIndex];
            const multi = lightboxImages.length > 1;
            document.getElementById('lightboxPrevBtn').classList.toggle('hidden', !multi);
            document.getElementById('lightboxNextBtn').classList.toggle('hidden', !multi);
            document.getElementById('lightboxCounter').textContent = multi ? (lightboxIndex + 1) + ' / ' + lightboxImages.length : '';
        }

        function lightboxNav(delta) {
            if (!lightboxImages.length) return;
            lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
            renderLightbox();
        }

        function closeImageLightbox() {
            document.getElementById('imageLightbox').classList.add('hidden');
        }

        // Called from the attachments button when more than one link exists.
        // Toggles a dropdown of real <a target="_blank"> links instead of using
        // window.open() from JS, because some Android WebView-based apps don't
        // implement onCreateWindow()/setSupportMultipleWindows() and silently
        // block window.open() while still handling normal anchor-tag clicks.
        // Called from the attachments button when more than one link exists.
        // Uses real <a target="_blank"> links inside a dropdown instead of
        // window.open() from JS (see note on Android WebView above the old
        // implementation this replaced).
        //
        // The dropdown is temporarily moved to <body> and positioned with
        // "position: fixed" next to the button. This is necessary because the
        // booking card it lives in uses "overflow: hidden" + "transform" (for
        // its hover animation), which clips/repositions any absolutely
        // positioned child — that's why only the first attachment used to be
        // visible while the rest were clipped off.
        function toggleAttachmentDropdown(btn, evt) {
            if (evt) evt.stopPropagation();
            const dd = document.getElementById(btn.dataset.attachTarget);
            if (!dd) return;
            // Close any other open attachment dropdowns first
            document.querySelectorAll('.attachment-dropdown').forEach(el => {
                if (el !== dd) el.classList.add('hidden');
            });
            const willOpen = dd.classList.contains('hidden');
            dd.classList.toggle('hidden');
            if (willOpen) {
                document.body.appendChild(dd);
                const rect = btn.getBoundingClientRect();
                dd.style.position = 'fixed';
                dd.style.top = (rect.bottom + 6) + 'px';
                dd.style.left = rect.left + 'px';
                dd.style.minWidth = rect.width + 'px';
                // Keep the button reachable from the dropdown so outside-click
                // detection (which checks .attachment-dropdown-container) still
                // works after the dropdown has been reparented to <body>.
                dd._ownerBtn = btn;
            }
        }

        // Removes any attachment dropdowns that were reparented to <body> by
        // toggleAttachmentDropdown(). Must be called whenever the bookings
        // list that owns them is re-rendered or its modal is closed, otherwise
        // the moved elements would be orphaned in the DOM.
        function cleanupAttachmentDropdowns() {
            document.querySelectorAll('body > .attachment-dropdown').forEach(el => el.remove());
        }

        // ─── Global New Booking Modal ─────────────────────────────────────
        function openGlobalBookingForEdit(id, groupId) {
            const booking = state.bookings.find(b => b.id === id);
            if (!booking) return;

            // Always track the groupId (not the individual day id) for smart-merge edits
            const resolvedGroupId = groupId || booking.groupId || id;
            state.editingBookingId = resolvedGroupId;

            const modal = document.getElementById('globalBookingModal');
            const select = document.getElementById('globalHallSelect');
            select.innerHTML = '<option value="">-- يرجى تحديد القاعة --</option>' +
                HALLS.map(h => '<option value="' + h.id + '">' + h.name + '</option>').join('');

            const form = document.getElementById('globalBookingForm');
            form.reset();

            select.value = booking.hallId;

            // Determine the full group date range to display in the form
            let startDate = booking.startDate, endDate = booking.endDate || booking.startDate;
            if (booking.originalRange && booking.originalRange.includes(' to ')) {
                const p = booking.originalRange.split(' to ');
                startDate = p[0]; endDate = p[1];
            } else {
                // Calculate range from all days in the group
                const groupDays = state.bookings
                    .filter(b => b.groupId === resolvedGroupId || b.id === resolvedGroupId)
                    .map(b => b.startDate)
                    .sort();
                if (groupDays.length > 0) {
                    startDate = groupDays[0];
                    endDate   = groupDays[groupDays.length - 1];
                }
            }

            form.querySelector('input[name="dateFrom"]').value   = startDate;
            form.querySelector('input[name="dateTo"]').value     = endDate;
            form.querySelector('input[name="timeFrom"]').value   = booking.startTime  || '';
            form.querySelector('input[name="timeTo"]').value     = booking.endTime    || '';
            form.querySelector('input[name="company"]').value    = booking.companyName|| '';
            form.querySelector('input[name="phone"]').value      = booking.phone      || '';
            form.querySelector('input[name="employee"]').value   = booking.employee   || '';
            form.querySelector('textarea[name="notes"]').value   = booking.notes      || '';
            setLinksInForm(getBookingLinks(booking));
            setFormImages(getBookingImages(booking));

            // إظهار قسم "نوع الحجز" للأدمن فقط عند التعديل
            const bookingTypeSectionEdit = document.getElementById('bookingTypeSection');
            if (bookingTypeSectionEdit) {
                if (state.currentUserEmail === ADMIN_EMAIL) {
                    bookingTypeSectionEdit.classList.remove('hidden');
                } else {
                    bookingTypeSectionEdit.classList.add('hidden');
                }
            }

            document.getElementById('globalEventType').value = booking.eventType === 'wedding' ? 'wedding' : 'normal';
            if (booking.eventType === 'wedding') {
                document.getElementById('weddingCalcSection').classList.remove('hidden');
                fillWeddingFormFromBooking(booking.wedding);
            } else {
                document.getElementById('weddingCalcSection').classList.add('hidden');
                fillWeddingFormFromBooking(null);
            }

            form.querySelector('button[type="submit"]').innerHTML =
                '<i data-lucide="check-circle" class="w-6 h-6 text-[#A88A45]"></i><span>حفظ التعديلات المطبقة</span>';

            const titleEl = document.getElementById('globalModalTitle');
            if (titleEl) titleEl.textContent = 'تعديل الحجز الحالي';
            modal.classList.remove('hidden');
            if(typeof lucide!=="undefined") lucide.createIcons();
        }

        function toggleGlobalBookingModal() {
            if (isGuest()) return;
            const modal = document.getElementById('globalBookingModal');
            if (!modal) return;

            if (modal.classList.contains('hidden')) {
                state.editingBookingId = null;
                const select = document.getElementById('globalHallSelect');
                select.innerHTML = '<option value="">-- يرجى تحديد القاعة --</option>' +
                    HALLS.map(h => '<option value="' + h.id + '">' + h.name + '</option>').join('');

                const today = new Date().toISOString().split('T')[0];
                const form  = document.getElementById('globalBookingForm');
                form.reset();
                select.value = '';
                form.querySelector('input[name="dateFrom"]').value = today;
                form.querySelector('input[name="dateTo"]').value   = today;
                form.querySelector('input[name="employee"]').value = getDefaultEmployeeName();
                setLinksInForm([]);
                setFormImages([]);
                document.getElementById('globalEventType').value = 'normal';
                document.getElementById('weddingCalcSection').classList.add('hidden');
                fillWeddingFormFromBooking(null);
                form.querySelector('button[type="submit"]').innerHTML =
                    '<i data-lucide="check-circle" class="w-6 h-6 text-[#A88A45]"></i><span>حفظ بيانات الحجز</span>';
                const titleEl = document.getElementById('globalModalTitle');
                if (titleEl) titleEl.textContent = 'حجز جديد';

                modal.classList.remove('hidden');
                if(typeof lucide!=="undefined") lucide.createIcons();
            } else {
                state.editingBookingId = null;
                modal.classList.add('hidden');
            }
        }

        // ═══════════════════ حاسبة باقة الفرح — مدمجة داخل فورم الحجز ═══════════════════

        function onEventTypeChange() {
            const type = document.getElementById('globalEventType').value;
            const section = document.getElementById('weddingCalcSection');
            if (type === 'wedding') {
                section.classList.remove('hidden');
                if (!document.getElementById('weddingPackageSelect').options.length) {
                    populateWeddingPackageSelect();
                    renderWeddingExtrasInputs();
                    renderWeddingPaymentsInputs();
                    onWeddingPackageChange();
                }
                applyWeddingFieldPermissions();
                recalcWeddingTotals();
            } else {
                section.classList.add('hidden');
            }
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function populateWeddingPackageSelect() {
            const select = document.getElementById('weddingPackageSelect');
            if (!select) return;
            const current = select.value;
            select.innerHTML = state.weddingSettings.packages.map(p =>
                `<option value="${p.id}">${p.name} (افتراضي ${fmtEGP(p.price)}/فرد)</option>`
            ).join('');
            if (current && state.weddingSettings.packages.some(p => p.id === current)) select.value = current;
        }

        function onWeddingPackageChange() {
            const pkgId = document.getElementById('weddingPackageSelect').value;
            const pkg = state.weddingSettings.packages.find(p => p.id === pkgId);
            if (pkg) document.getElementById('weddingPricePerPerson').value = pkg.price;
            renderWeddingPackageMenuPreview(pkg ? (pkg.menuItems || []) : [], pkg ? (pkg.menuNotes || '') : '');
            recalcWeddingTotals();
        }

        function renderWeddingPackageMenuPreview(items, notes) {
            const box = document.getElementById('weddingPackageMenuPreview');
            if (!box) return;
            box.classList.remove('hidden');
            const list = document.getElementById('weddingMenuItemsList');
            list.innerHTML = (items && items.length ? items : ['']).map((item, i) => `
                <div class="flex items-center gap-2">
                    <input type="text" class="wedding-menu-item flex-1 text-sm" data-idx="${i}" value="${escapeHtml(item || '')}" placeholder="اسم الصنف">
                    <button type="button" onclick="removeWeddingMenuItem(${i})" class="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0" title="حذف الصنف">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
            `).join('');
            document.getElementById('weddingMenuNotes').value = notes || '';
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function getWeddingMenuItemsFromForm() {
            return Array.from(document.querySelectorAll('.wedding-menu-item')).map(inp => inp.value.trim()).filter(v => v);
        }

        function getWeddingMenuNotesFromForm() {
            const ta = document.getElementById('weddingMenuNotes');
            return ta ? ta.value.trim() : '';
        }

        function addWeddingMenuItem() {
            const items = getWeddingMenuItemsFromForm();
            items.push('');
            renderWeddingPackageMenuPreview(items, getWeddingMenuNotesFromForm());
            document.querySelectorAll('.wedding-menu-item')[items.length - 1]?.focus();
        }

        function removeWeddingMenuItem(idx) {
            const items = Array.from(document.querySelectorAll('.wedding-menu-item')).map(inp => inp.value);
            items.splice(idx, 1);
            renderWeddingPackageMenuPreview(items, getWeddingMenuNotesFromForm());
        }

        // بناء صف إضافة واحد (يُستخدم لعناصر الكتالوج الثابتة ولعناصر مخصّصة يضيفها المستخدم لهذا الحجز فقط)
        function weddingExtraRowHtml(key, name, value, perGuest, checked) {
            const safeName = (name || '').replace(/"/g, '&quot;');
            return `
                <div class="extra-row bg-slate-50 border border-slate-200 rounded-xl p-3" data-extra-row="${key}">
                    <div class="flex items-center gap-2 mb-2">
                        <input type="checkbox" class="wedding-extra-toggle" data-extra="${key}" ${checked ? 'checked' : ''} onchange="recalcWeddingTotals()">
                        <input type="text" class="wedding-extra-name flex-1 text-sm font-bold text-slate-700 bg-transparent border-0 outline-none rounded px-1 focus:bg-white focus:ring-2 focus:ring-amber-100" data-extra="${key}" value="${safeName}" placeholder="اسم الإضافة" oninput="recalcWeddingTotals()">
                        <button type="button" onclick="removeWeddingExtraRow('${key}')" class="text-slate-400 hover:text-red-600 transition-colors shrink-0 p-1" title="حذف هذه الإضافة">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <input type="number" class="wedding-extra-value" data-extra="${key}" value="${value}" min="0" step="any" oninput="recalcWeddingTotals()">
                        <label class="flex items-center gap-1 text-xs text-slate-400 shrink-0 cursor-pointer">
                            <input type="checkbox" class="wedding-extra-perguest" data-extra="${key}" ${perGuest ? 'checked' : ''} onchange="recalcWeddingTotals()">
                            × فرد
                        </label>
                    </div>
                </div>
            `;
        }

        // customExtras: عناصر خاصة بهذا الحجز فقط (أُضيفت يدويًا ولا توجد في كتالوج الإعدادات العام)
        function renderWeddingExtrasInputs(customExtras) {
            const container = document.getElementById('weddingExtrasContainer');
            if (!container) return;
            const catalogHtml = state.weddingSettings.extras.map(ex =>
                weddingExtraRowHtml(ex.key, ex.name, ex.value, ex.perGuest, false)
            ).join('');
            const customHtml = (customExtras || []).map(ex =>
                weddingExtraRowHtml(ex.key, ex.name, ex.value, ex.perGuest, !!ex.active)
            ).join('');
            container.innerHTML = catalogHtml + customHtml;
            applyWeddingFieldPermissions();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // إضافة عنصر إضافة جديد مخصّص لهذا الحجز فقط (بدون التأثير على كتالوج الإعدادات العام)
        function addWeddingExtraRow() {
            const container = document.getElementById('weddingExtrasContainer');
            if (!container) return;
            const key = 'custom_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            container.insertAdjacentHTML('beforeend', weddingExtraRowHtml(key, '', 0, false, true));
            applyWeddingFieldPermissions();
            if (typeof lucide !== 'undefined') lucide.createIcons();
            const nameInput = container.querySelector(`.wedding-extra-name[data-extra="${key}"]`);
            if (nameInput) nameInput.focus();
            recalcWeddingTotals();
        }

        // حذف عنصر إضافة من هذا الحجز فقط (لا يمس كتالوج الإعدادات العام)
        function removeWeddingExtraRow(key) {
            const row = document.querySelector(`.extra-row[data-extra-row="${key}"]`);
            if (row) row.remove();
            recalcWeddingTotals();
        }

        function renderWeddingPaymentsInputs() {
            const container = document.getElementById('weddingPaymentsContainer');
            if (!container) return;
            container.innerHTML = [1,2,3,4,5,6].map(n =>
                `<input type="number" class="wedding-payment-input" placeholder="دفعة ${n}" min="0" step="any" oninput="recalcWeddingTotals()">`
            ).join('');
        }

        // يقفل حقول الأسعار والخصومات على غير الأدمن (اختيار الباقة وعدد الأفراد والدفعات يبقى متاح للجميع)
        function applyWeddingFieldPermissions() {
            const isAdmin = state.currentUserEmail === ADMIN_EMAIL;
            const priceInput = document.getElementById('weddingPricePerPerson');
            if (priceInput) priceInput.disabled = !isAdmin;
            document.querySelectorAll('.wedding-extra-value').forEach(el => el.disabled = !isAdmin);
            document.querySelectorAll('.wedding-extra-perguest').forEach(el => el.disabled = !isAdmin);
        }

        function getWeddingExtrasBreakdown() {
            const guests = parseFloat(document.getElementById('weddingGuests').value) || 0;
            let extrasTotal = 0, chairTotal = 0;
            const extras = [];
            document.querySelectorAll('.wedding-extra-toggle').forEach(cb => {
                const key = cb.dataset.extra;
                const nameInput = document.querySelector(`.wedding-extra-name[data-extra="${key}"]`);
                const valInput = document.querySelector(`.wedding-extra-value[data-extra="${key}"]`);
                const perGuestInput = document.querySelector(`.wedding-extra-perguest[data-extra="${key}"]`);
                const def = state.weddingSettings.extras.find(e => e.key === key);
                const name = (nameInput ? nameInput.value.trim() : '') || (def ? def.name : key);
                const perGuest = perGuestInput ? perGuestInput.checked : !!(def && def.perGuest);
                const value = parseFloat(valInput.value) || 0;
                const active = cb.checked;
                let lineTotal = 0;
                if (active) {
                    lineTotal = perGuest ? value * guests : value;
                    if (perGuest) chairTotal += lineTotal; else extrasTotal += lineTotal;
                }
                extras.push({ key, name, perGuest, value, active, lineTotal });
            });
            return { guests, extras, extrasTotal, chairTotal };
        }

        function recalcWeddingTotals() {
            const box = document.getElementById('weddingTotalsBox');
            if (!box) return;
            const price = parseFloat(document.getElementById('weddingPricePerPerson').value) || 0;
            const { guests, extrasTotal, chairTotal } = getWeddingExtrasBreakdown();
            const subtotal = price * guests;
            const total = subtotal + extrasTotal + chairTotal;

            let paid = 0;
            document.querySelectorAll('.wedding-payment-input').forEach(inp => { paid += parseFloat(inp.value) || 0; });
            const remaining = total - paid;

            box.innerHTML = `
                <div class="flex justify-between text-slate-600"><span>إجمالي الأفراد (${guests} × ${fmtEGP(price)})</span><span class="font-bold">${fmtEGP(subtotal)}</span></div>
                <div class="flex justify-between text-slate-600"><span>الإضافات</span><span class="font-bold">${fmtEGP(extrasTotal)}</span></div>
                <div class="flex justify-between text-slate-600"><span>كرسي الديكور</span><span class="font-bold">${fmtEGP(chairTotal)}</span></div>
                <div class="flex justify-between text-base text-[#6E1418] font-black pt-2 border-t border-amber-200"><span>الإجمالي</span><span>${fmtEGP(total)}</span></div>
                <div class="flex justify-between text-emerald-700 font-bold"><span>المدفوع</span><span>${fmtEGP(paid)}</span></div>
                <div class="flex justify-between font-black ${remaining > 0 ? 'text-red-600' : 'text-emerald-700'}"><span>المتبقي</span><span>${fmtEGP(remaining)}</span></div>
            `;
        }

        function collectWeddingDataFromForm() {
            const pkgId = document.getElementById('weddingPackageSelect').value;
            const pkg = state.weddingSettings.packages.find(p => p.id === pkgId);
            const price = parseFloat(document.getElementById('weddingPricePerPerson').value) || 0;
            const { guests, extras, extrasTotal, chairTotal } = getWeddingExtrasBreakdown();
            const subtotal = price * guests;
            const total = subtotal + extrasTotal + chairTotal;
            const payments = Array.from(document.querySelectorAll('.wedding-payment-input')).map(inp => parseFloat(inp.value) || 0);
            const paidTotal = payments.reduce((s, n) => s + n, 0);

            return {
                packageId: pkgId,
                packageName: pkg ? pkg.name : (pkgId || '-'),
                pricePerPerson: price,
                guests,
                subtotal,
                extras,
                extrasTotal,
                chairTotal,
                total,
                payments,
                paidTotal,
                remaining: total - paidTotal,
                menuItems: getWeddingMenuItemsFromForm(),
                menuNotes: getWeddingMenuNotesFromForm(),
                calculatedAt: new Date().toISOString()
            };
        }

        function fillWeddingFormFromBooking(w) {
            if (!document.getElementById('weddingPackageSelect').options.length) populateWeddingPackageSelect();
            // عناصر هذا الحجز التي لا توجد في كتالوج الإعدادات العام (أُضيفت يدويًا لهذا الحجز فقط) — لازم تُعرض كصفوف إضافية
            const catalogKeys = new Set(state.weddingSettings.extras.map(ex => ex.key));
            const customExtras = (w && w.extras) ? w.extras.filter(ex => !catalogKeys.has(ex.key)) : [];
            renderWeddingExtrasInputs(customExtras);
            renderWeddingPaymentsInputs();
            applyWeddingFieldPermissions();
            if (!w) { recalcWeddingTotals(); return; }

            document.getElementById('weddingPackageSelect').value = w.packageId || '';
            document.getElementById('weddingGuests').value = w.guests || 0;
            document.getElementById('weddingPricePerPerson').value = w.pricePerPerson || 0;
            const pkgForMenu = state.weddingSettings.packages.find(p => p.id === (w.packageId || ''));
            const menuItems = (w.menuItems && w.menuItems.length) ? w.menuItems : (pkgForMenu ? pkgForMenu.menuItems : []);
            const menuNotes = (w.menuNotes !== undefined && w.menuNotes !== '') ? w.menuNotes : (pkgForMenu ? pkgForMenu.menuNotes : '');
            renderWeddingPackageMenuPreview(menuItems, menuNotes);

            (w.extras || []).forEach(ex => {
                const cb = document.querySelector(`.wedding-extra-toggle[data-extra="${ex.key}"]`);
                const valInput = document.querySelector(`.wedding-extra-value[data-extra="${ex.key}"]`);
                const nameInput = document.querySelector(`.wedding-extra-name[data-extra="${ex.key}"]`);
                const perGuestInput = document.querySelector(`.wedding-extra-perguest[data-extra="${ex.key}"]`);
                if (cb) cb.checked = !!ex.active;
                if (valInput) valInput.value = ex.value;
                if (nameInput && ex.name) nameInput.value = ex.name;
                if (perGuestInput) perGuestInput.checked = !!ex.perGuest;
            });

            const paymentInputs = document.querySelectorAll('.wedding-payment-input');
            (w.payments || []).forEach((val, i) => { if (paymentInputs[i]) paymentInputs[i].value = val || ''; });

            recalcWeddingTotals();
        }

        // نص/صفوف تفاصيل باقة الفرح لإدراجها في: مودال التفاصيل، الطباعة، البريد، والمشاركة
        // opts.excludePrices = true لإخفاء صفوف الإجمالي/المدفوع/المتبقي (يُستخدم في البريد لأن ملف PDF بالأسعار يُرفق يدويًا)
        function weddingSummaryRows(b, opts) {
            if (!b || b.eventType !== 'wedding' || !b.wedding) return [];
            const excludePrices = !!(opts && opts.excludePrices);
            const hideRoomsExtra = !!(opts && opts.hideRoomsExtra);
            const w = b.wedding;
            const activeExtras = (w.extras || []).filter(ex => ex.active && !(hideRoomsExtra && ex.key === 'rooms'));
            const extrasLine = activeExtras.length
                ? activeExtras.map(ex => ex.name).join(' + ')
                : 'لا يوجد';
            const pkg = state.weddingSettings.packages.find(p => p.id === w.packageId);
            const menuItems = (w.menuItems && w.menuItems.filter(m => m.trim()).length) ? w.menuItems.filter(m => m.trim()) : (pkg && pkg.menuItems ? pkg.menuItems.filter(m => m.trim()) : []);
            const menuNotes = (w.menuNotes && w.menuNotes.trim()) ? w.menuNotes.trim() : (pkg && pkg.menuNotes ? pkg.menuNotes.trim() : '');
            const rows = [
                ['نوع الحجز', 'فرح / خطوبة — باقة ' + (w.packageName || '-')],
            ];
            if (menuItems.length) rows.push(['المنيو', menuItems.join('، ')]);
            if (menuNotes) rows.push(['ملاحظات المنيو', menuNotes]);
            const guestsCount = w.guests || 0;
            const pricePerPerson = w.pricePerPerson || 0;
            const menuTotal = (w.subtotal !== undefined && w.subtotal !== null) ? w.subtotal : (guestsCount * pricePerPerson);
            const guestsValue = (pricePerPerson && !excludePrices)
                ? `${guestsCount} فرد × ${fmtEGP(pricePerPerson)} = ${fmtEGP(menuTotal)} (إجمالي المنيو)`
                : `${guestsCount} فرد`;
            rows.push(
                ['عدد الأفراد', guestsValue],
                ['الإضافات', extrasLine],
            );
            if (!excludePrices) {
                rows.push(
                    ['إجمالي الحجز', fmtEGP(w.total)],
                    ['المدفوع', fmtEGP(w.paidTotal)],
                    ['المتبقي', fmtEGP(w.remaining)],
                );
            }
            return rows;
        }
        function weddingSummaryLines(b, opts) {
            return weddingSummaryRows(b, opts).map(r => `${r[0]}: ${r[1]}`);
        }

        // ═══════════════════ حاسبة باقة فرح سريعة (بدون حفظ كحجز) ═══════════════════

        function toggleQuickCalcModal() {
            if (isGuest() || state.currentUserEmail !== ADMIN_EMAIL) return;
            const modal = document.getElementById('quickCalcModal');
            if (modal.classList.contains('hidden')) {
                renderQuickCalcModal();
                modal.classList.remove('hidden');
            } else {
                modal.classList.add('hidden');
            }
        }

        function renderQuickCalcModal() {
            const isAdmin = state.currentUserEmail === ADMIN_EMAIL;
            const body = document.getElementById('quickCalcBody');
            body.innerHTML = `
                <div class="input-group bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <label class="required">الباقة</label>
                    <select id="qcPackageSelect" onchange="onQcPackageChange()">
                        ${state.weddingSettings.packages.map(p => `<option value="${p.id}">${p.name} (${fmtEGP(p.price)}/فرد)</option>`).join('')}
                    </select>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div class="input-group bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                        <label class="required">عدد الأفراد</label>
                        <input type="number" id="qcGuests" min="0" step="1" value="0" oninput="recalcQuickCalc()">
                    </div>
                    <div class="input-group bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                        <label>سعر الفرد (جنيه)</label>
                        <input type="number" id="qcPricePerPerson" min="0" step="any" value="0" ${isAdmin ? '' : 'disabled'} oninput="recalcQuickCalc()">
                    </div>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2.5" id="qcExtrasContainer">
                    ${state.weddingSettings.extras.map(ex => `
                        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <label class="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2 cursor-pointer">
                                <input type="checkbox" class="qc-extra-toggle" data-extra="${ex.key}" onchange="recalcQuickCalc()">
                                ${ex.name} ${ex.perGuest ? '<span class="text-[10px] text-slate-400 font-normal">(× عدد الأفراد)</span>' : ''}
                            </label>
                            <div class="flex items-center gap-2">
                                <input type="number" class="qc-extra-value" data-extra="${ex.key}" value="${ex.value}" min="0" step="any" ${isAdmin ? '' : 'disabled'} oninput="recalcQuickCalc()">
                                <span class="text-xs text-slate-400 shrink-0">${ex.perGuest ? 'جنيه/فرد' : 'جنيه'}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div id="qcTotalsBox" class="bg-amber-50/60 rounded-xl p-4 space-y-1.5 text-sm border border-amber-100"></div>
                <button type="button" onclick="convertQuickCalcToBooking()" class="w-full bg-gradient-to-r from-[#6E1418] to-[#8a1c22] hover:from-[#5a1013] hover:to-[#6E1418] text-white font-black py-4 rounded-2xl shadow-xl shadow-[#6E1418]/30 transition-all duration-300 transform active:scale-[0.98] flex items-center justify-center gap-3 text-lg">
                    <i data-lucide="calendar-plus" class="w-6 h-6 text-[#A88A45]"></i>
                    <span>تحويل إلى حجز جديد</span>
                </button>
            `;
            onQcPackageChange();
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function onQcPackageChange() {
            const pkg = state.weddingSettings.packages.find(p => p.id === document.getElementById('qcPackageSelect').value);
            if (pkg) document.getElementById('qcPricePerPerson').value = pkg.price;
            recalcQuickCalc();
        }

        function recalcQuickCalc() {
            const guests = parseFloat(document.getElementById('qcGuests').value) || 0;
            const price = parseFloat(document.getElementById('qcPricePerPerson').value) || 0;
            let extrasTotal = 0, chairTotal = 0;
            document.querySelectorAll('.qc-extra-toggle').forEach(cb => {
                if (!cb.checked) return;
                const key = cb.dataset.extra;
                const def = state.weddingSettings.extras.find(e => e.key === key) || {};
                const val = parseFloat(document.querySelector(`.qc-extra-value[data-extra="${key}"]`).value) || 0;
                if (def.perGuest) chairTotal += val * guests; else extrasTotal += val;
            });
            const subtotal = price * guests;
            const total = subtotal + extrasTotal + chairTotal;
            document.getElementById('qcTotalsBox').innerHTML = `
                <div class="flex justify-between text-slate-600"><span>إجمالي الأفراد</span><span class="font-bold">${fmtEGP(subtotal)}</span></div>
                <div class="flex justify-between text-slate-600"><span>الإضافات</span><span class="font-bold">${fmtEGP(extrasTotal)}</span></div>
                <div class="flex justify-between text-slate-600"><span>كرسي الديكور</span><span class="font-bold">${fmtEGP(chairTotal)}</span></div>
                <div class="flex justify-between text-base text-[#6E1418] font-black pt-2 border-t border-amber-200"><span>الإجمالي</span><span>${fmtEGP(total)}</span></div>
            `;
        }

        // ينقل بيانات الحاسبة السريعة إلى فورم حجز جديد (نوع فرح/خطوبة) ليكمل الموظف باقي بيانات الحجز
        function convertQuickCalcToBooking() {
            const pkgId = document.getElementById('qcPackageSelect').value;
            const guests = document.getElementById('qcGuests').value;
            const price = document.getElementById('qcPricePerPerson').value;
            const extraStates = Array.from(document.querySelectorAll('.qc-extra-toggle')).map(cb => ({
                key: cb.dataset.extra,
                active: cb.checked,
                value: parseFloat(document.querySelector(`.qc-extra-value[data-extra="${cb.dataset.extra}"]`).value) || 0
            }));

            document.getElementById('quickCalcModal').classList.add('hidden');
            toggleGlobalBookingModal(); // يفتح فورم حجز جديد بالحالة الافتراضية

            document.getElementById('globalEventType').value = 'wedding';
            onEventTypeChange();

            document.getElementById('weddingPackageSelect').value = pkgId;
            document.getElementById('weddingGuests').value = guests;
            document.getElementById('weddingPricePerPerson').value = price;
            extraStates.forEach(st => {
                const cb = document.querySelector(`.wedding-extra-toggle[data-extra="${st.key}"]`);
                const valInput = document.querySelector(`.wedding-extra-value[data-extra="${st.key}"]`);
                if (cb) cb.checked = st.active;
                if (valInput) valInput.value = st.value;
            });
            recalcWeddingTotals();
            showToast('تم نقل بيانات الحاسبة — أكمل بيانات القاعة والعميل والتاريخ', 'success');
        }

        // ═══════════════════ إعدادات باقات الأفراح (أدمن فقط) ═══════════════════

        function toggleWeddingSettingsModal() {
            if (state.currentUserEmail !== ADMIN_EMAIL) return;
            const modal = document.getElementById('weddingSettingsModal');
            if (modal.classList.contains('hidden')) {
                renderWeddingSettingsModal();
                modal.classList.remove('hidden');
            } else {
                modal.classList.add('hidden');
            }
        }

        function renderWeddingSettingsModal() {
            const body = document.getElementById('weddingSettingsBody');
            body.innerHTML = `
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="font-bold text-[#6E1418] mb-3">أسعار الباقات (جنيه/فرد)</div>
                    <div class="space-y-2.5">
                        ${state.weddingSettings.packages.map((p, i) => `
                            <div class="flex items-center gap-3">
                                <span class="flex-1 text-sm font-bold text-slate-600">${p.name}</span>
                                <input type="number" class="ws-package-price w-32" data-idx="${i}" value="${p.price}" min="0" step="any">
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="font-bold text-[#6E1418] mb-3 flex items-center gap-2">
                        <i data-lucide="utensils" class="w-4 h-4"></i> منيو الباقات
                    </div>
                    <div class="space-y-4">
                        ${state.weddingSettings.packages.map((p, i) => `
                            <div class="border border-slate-200 rounded-2xl overflow-hidden">
                                <button type="button" onclick="toggleMenuSection(${i})"
                                    class="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                                    <span class="font-bold text-sm text-slate-700 flex items-center gap-2">
                                        <i data-lucide="chef-hat" class="w-4 h-4 text-[#A88A45]"></i>
                                        باقة ${p.name}
                                        <span class="text-[10px] font-normal text-slate-400">(${(p.menuItems||[]).length} صنف)</span>
                                    </span>
                                    <i data-lucide="chevron-down" class="w-4 h-4 text-slate-400 menu-chevron-${i} transition-transform"></i>
                                </button>
                                <div id="menuSection_${i}" class="hidden p-4 space-y-3 bg-white">
                                    <div id="menuItems_${i}" class="space-y-2">
                                        ${(p.menuItems||[]).map((item, j) => `
                                            <div class="flex items-center gap-2 menu-item-row">
                                                <input type="text" class="ws-menu-item flex-1 text-sm" data-pkg="${i}" data-item="${j}"
                                                    value="${escapeHtml(item)}" placeholder="مثال: شوربة فراخ">
                                                <button type="button" onclick="removeMenuItem(${i},${j})"
                                                    class="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                                                </button>
                                            </div>
                                        `).join('')}
                                    </div>
                                    <button type="button" onclick="addMenuItem(${i})"
                                        class="inline-flex items-center gap-1.5 text-xs font-bold text-[#6E1418] hover:text-white hover:bg-[#6E1418] bg-[#6E1418]/5 px-3 py-1.5 rounded-lg transition-colors border border-[#6E1418]/10">
                                        <i data-lucide="plus" class="w-3.5 h-3.5"></i> إضافة صنف
                                    </button>
                                    <div>
                                        <label class="text-xs font-bold text-slate-500 mb-1 block">ملاحظات المنيو</label>
                                        <textarea class="ws-menu-notes w-full text-sm rounded-xl border border-slate-200 p-2.5 resize-none bg-slate-50 outline-none focus:border-[#A88A45] focus:bg-white" 
                                            data-pkg="${i}" rows="2" placeholder="أي تفاصيل إضافية عن المنيو...">${escapeHtml(p.menuNotes||'')}</textarea>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="font-bold text-[#6E1418] mb-3">الإضافات</div>
                    <div class="space-y-2.5">
                        ${state.weddingSettings.extras.map((ex, i) => `
                            <div class="flex items-center gap-3">
                                <span class="flex-1 text-sm font-bold text-slate-600">${ex.name} ${ex.perGuest ? '<span class="text-[10px] text-slate-400">(جنيه/فرد)</span>' : ''}</span>
                                <input type="number" class="ws-extra-value w-32" data-idx="${i}" value="${ex.value}" min="0" step="any">
                            </div>
                        `).join('')}
                    </div>
                </div>
                <button type="button" onclick="commitWeddingSettingsFromForm()" class="w-full bg-gradient-to-r from-[#6E1418] to-[#8a1c22] text-white font-black py-3.5 rounded-2xl shadow-lg flex items-center justify-center gap-2">
                    <i data-lucide="check-circle" class="w-5 h-5 text-[#A88A45]"></i> حفظ الإعدادات
                </button>
            `;
            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        function toggleMenuSection(pkgIdx) {
            const section = document.getElementById('menuSection_' + pkgIdx);
            const chevron = document.querySelector('.menu-chevron-' + pkgIdx);
            if (!section) return;
            const isHidden = section.classList.contains('hidden');
            section.classList.toggle('hidden', !isHidden);
            if (chevron) chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
        }

        function addMenuItem(pkgIdx) {
            // حفظ القيم الحالية أولاً قبل إعادة الرسم
            _collectMenuFromForm();
            const p = state.weddingSettings.packages[pkgIdx];
            if (!p.menuItems) p.menuItems = [];
            p.menuItems.push('');
            renderWeddingSettingsModal();
            // إعادة فتح القسم
            const section = document.getElementById('menuSection_' + pkgIdx);
            const chevron = document.querySelector('.menu-chevron-' + pkgIdx);
            if (section) { section.classList.remove('hidden'); if (chevron) chevron.style.transform = 'rotate(180deg)'; }
            // التركيز على آخر حقل
            const inputs = document.querySelectorAll(`.ws-menu-item[data-pkg="${pkgIdx}"]`);
            if (inputs.length) inputs[inputs.length - 1].focus();
        }

        function removeMenuItem(pkgIdx, itemIdx) {
            _collectMenuFromForm();
            const p = state.weddingSettings.packages[pkgIdx];
            if (!p.menuItems) return;
            p.menuItems.splice(itemIdx, 1);
            renderWeddingSettingsModal();
            const section = document.getElementById('menuSection_' + pkgIdx);
            const chevron = document.querySelector('.menu-chevron-' + pkgIdx);
            if (section) { section.classList.remove('hidden'); if (chevron) chevron.style.transform = 'rotate(180deg)'; }
        }

        function _collectMenuFromForm() {
            document.querySelectorAll('.ws-menu-item').forEach(inp => {
                const pi = Number(inp.dataset.pkg), ii = Number(inp.dataset.item);
                if (state.weddingSettings.packages[pi]) {
                    if (!state.weddingSettings.packages[pi].menuItems) state.weddingSettings.packages[pi].menuItems = [];
                    state.weddingSettings.packages[pi].menuItems[ii] = inp.value;
                }
            });
            document.querySelectorAll('.ws-menu-notes').forEach(ta => {
                const pi = Number(ta.dataset.pkg);
                if (state.weddingSettings.packages[pi]) state.weddingSettings.packages[pi].menuNotes = ta.value;
            });
        }

        function commitWeddingSettingsFromForm() {
            document.querySelectorAll('.ws-package-price').forEach(inp => {
                state.weddingSettings.packages[Number(inp.dataset.idx)].price = parseFloat(inp.value) || 0;
            });
            document.querySelectorAll('.ws-extra-value').forEach(inp => {
                state.weddingSettings.extras[Number(inp.dataset.idx)].value = parseFloat(inp.value) || 0;
            });
            _collectMenuFromForm();
            saveWeddingSettingsToCloud();
        }

        function handleGlobalBookingSubmit(e) {
            e.preventDefault();

            // ─── منع الإرسال المزدوج ────────────────────────────────────────
            // نقرة مزدوجة (أو تاتش سريع مرتين) على زر الحفظ كانت تسبب تنفيذ هذه
            // الدالة مرتين قبل ما نقدر نغلق المودال: التنفيذ الأول يحفظ التعديل
            // بنجاح ويصفّر state.editingBookingId، لكن التنفيذ الثاني كان يشوف
            // إن مفيش editingBookingId فيعتبرها "حجز جديد" ويضيف نسخة مطابقة
            // لنفس اليوم بنفس البيانات. الحارس ده يمنع أي تنفيذ ثاني لحد ما
            // الأول يخلص تمامًا (نجاح أو فشل بالتحقق).
            if (handleGlobalBookingSubmit._busy) return;
            handleGlobalBookingSubmit._busy = true;

            const submitBtn = e.target.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                return handleGlobalBookingSubmitInner(e);
            } finally {
                handleGlobalBookingSubmit._busy = false;
                if (submitBtn) submitBtn.disabled = false;
            }
        }

        function handleGlobalBookingSubmitInner(e) {
            const form   = e.target;
            const hallId = form.hallId.value;
            const hall   = HALLS.find(h => h.id === hallId);
            if (!hall) { alert('الرجاء اختيار القاعة أولاً'); return; }

            const isEditing = !!state.editingBookingId;
            const bookingData = {
                hallId:      hall.id,
                hallName:    hall.name,
                companyName: form.company.value,
                phone:       form.phone.value,
                employee:    form.employee.value,
                startDate:   form.dateFrom.value,
                endDate:     form.dateTo.value,
                startTime:   form.timeFrom.value,
                endTime:     form.timeTo.value,
                notes:       form.notes.value,
                links:       getLinksFromForm(form),
                images:      formImages.slice(),
                createdBy:   isEditing
                    ? (state.bookings.find(b =>
                        b.groupId === state.editingBookingId || b.id === state.editingBookingId
                      )?.createdBy || state.currentUserEmail)
                    : state.currentUserEmail,
                createdAt:   new Date().toISOString(),
                eventType:   form.eventType ? form.eventType.value : 'normal',
                wedding:     (form.eventType && form.eventType.value === 'wedding') ? collectWeddingDataFromForm() : null
            };

            const start = new Date(bookingData.startDate);
            const end   = new Date(bookingData.endDate);
            if (end < start) { alert('تاريخ النهاية يجب أن يكون بعد تاريخ البداية'); return; }

            // ─── منع غير الأدمن من الحجز في أيام منصرمة ───────────────────
            if (!isEditing && state.currentUserEmail !== ADMIN_EMAIL && isPastDateStr(bookingData.startDate)) {
                alert('عذراً، لا يمكنك إضافة حجز في يوم منصرم. هذه الصلاحية للأدمن فقط.');
                return;
            }

            // Build new dates list
            const newDates = [];
            let cur = new Date(start);
            while (cur <= end) {
                newDates.push(cur.toISOString().split('T')[0]);
                cur.setDate(cur.getDate() + 1);
            }

            // Conflict check – ignore all days in the group being edited
            for (const ds of newDates) {
                if (checkConflict(bookingData.hallId, ds, bookingData.startTime, bookingData.endTime, state.editingBookingId, true)) {
                    alert('عذراً، يوجد حجز مسبق يوم ' + ds + ' في ' + bookingData.hallName + '.');
                    return;
                }
            }

            const groupId = isEditing
                ? state.editingBookingId
                : String(Date.now()) + '_' + Math.random().toString(36).slice(2);

            if (isEditing) {
                // ── Smart merge ──────────────────────────────────────────────
                // 1. Find all existing days of this group
                const existingGroupDays = state.bookings.filter(b =>
                    b.groupId === groupId || b.id === groupId
                );
                const existingDates = existingGroupDays.map(b => b.startDate);

                // 2. Remove days that are no longer in the new range
                const idsToRemove = existingGroupDays
                    .filter(b => !newDates.includes(b.startDate))
                    .map(b => b.id);
                // نسجّل كل يوم بيتشال بسبب تعديل النطاق كـ "حذف" في السجل، عشان
                // إشعار "تم حذف حجز بواسطة..." يقدر ينسب العملية لصاحبها الصحيح بدل ما يفشل يلاقي اسم
                existingGroupDays
                    .filter(b => idsToRemove.includes(b.id))
                    .forEach(b => {
                        state.activityLogs.unshift({
                            type:         'حذف',
                            company:      b.companyName,
                            hallName:     b.hallName || '',
                            user:         state.currentUserEmail,
                            bookingId:    b.id || '',
                            startDate:    b.startDate || '',
                            date:         new Date().toLocaleDateString('ar-EG'),
                            time:         new Date().toLocaleTimeString('ar-EG'),
                            isoTimestamp: new Date().toISOString()
                        });
                    });
                idsToRemove.forEach(did => state.pendingDeletions.push(did));
                state.bookings = state.bookings.filter(b => !idsToRemove.includes(b.id));

                // 3. Update shared metadata on all remaining group days
                state.bookings = state.bookings.map(b => {
                    if (b.groupId === groupId || b.id === groupId) {
                        return {
                            ...b,
                            hallId:        bookingData.hallId,
                            hallName:      bookingData.hallName,
                            companyName:   bookingData.companyName,
                            phone:         bookingData.phone,
                            employee:      bookingData.employee,
                            startTime:     bookingData.startTime,
                            endTime:       bookingData.endTime,
                            notes:         bookingData.notes,
                            links:         bookingData.links,
                            images:        bookingData.images,
                            eventType:     bookingData.eventType,
                            wedding:       bookingData.wedding,
                            originalRange: bookingData.startDate + ' to ' + bookingData.endDate,
                            _isDirty:      true
                        };
                    }
                    return b;
                });

                // 4. Add new days that didn't exist before
                // Reuse removed IDs when possible to avoid orphan records on the server
                const datesToAdd = newDates.filter(d => !existingDates.includes(d));
                const reuseIds = idsToRemove.slice(); // IDs freed up from step 2
                let dayIndex = existingGroupDays.length;
                datesToAdd.forEach(ds => {
                    let newId;
                    if (reuseIds.length > 0) {
                        // Reuse an old ID: remove it from pendingDeletions and update in-place
                        newId = reuseIds.shift();
                        state.pendingDeletions = state.pendingDeletions.filter(pid => pid !== newId);
                    } else {
                        newId = groupId + '_d' + dayIndex;
                        dayIndex++;
                    }
                    state.bookings.push({
                        ...bookingData,
                        id:            newId,
                        groupId:       groupId,
                        startDate:     ds,
                        originalRange: bookingData.startDate + ' to ' + bookingData.endDate,
                        _isDirty:      true
                    });
                });

            } else {
                // ── New booking: create all days ─────────────────────────────
                newDates.forEach((ds, dayIndex) => {
                    state.bookings.push({
                        ...bookingData,
                        id:            groupId + '_d' + dayIndex,
                        groupId:       groupId,
                        startDate:     ds,
                        originalRange: bookingData.startDate + ' to ' + bookingData.endDate,
                        _isDirty:      true
                    });
                });
            }

            const logType = isEditing ? 'تعديل' : 'إضافة';
            const _fmtD2 = bookingData.startDate ? bookingData.startDate.split('-').reverse().join('/') : '';
            const logMsg  = 'تم ' + logType + ' حجز - ' + bookingData.companyName + ' - بتاريخ ' + _fmtD2;
            addNotification(logMsg, 'add', bookingData.startDate);
            showToast(logMsg, 'success', bookingData.startDate);

            state.activityLogs.unshift({
                type:         logType,
                company:      bookingData.companyName,
                hallName:     bookingData.hallName || '',
                user:         state.currentUserEmail,
                date:         new Date().toLocaleDateString('ar-EG'),
                time:         new Date().toLocaleTimeString('ar-EG'),
                isoTimestamp: new Date().toISOString()
            });

            state.editingBookingId = null;
            saveLocal();
            toggleGlobalBookingModal();
            render();
        }


        // ─── الحجوزات المحذوفة (من الشيت المنفصل) ──────────────────────
        async function toggleDeletedBookingsModal() {
            if (isGuest()) return;
            const modal = document.getElementById('deletedBookingsModal');
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                if (typeof lucide !== "undefined") lucide.createIcons();
                await loadDeletedBookings();
            } else {
                modal.classList.add('hidden');
            }
        }

        async function loadDeletedBookings() {
            const deleteColHead = document.getElementById('deletedBookingsDeleteColHead');
            const isAdminUser = state.currentUserEmail === ADMIN_EMAIL;
            if (deleteColHead) deleteColHead.classList.toggle('hidden', !isAdminUser);
            const bulkBtn = document.getElementById('deletedBookingsBulkDeleteBtn');
            if (bulkBtn) {
                bulkBtn.classList.toggle('hidden', !isAdminUser);
                bulkBtn.classList.toggle('flex', isAdminUser);
            }
            const tbody = document.getElementById('deletedBookingsTableBody');
            tbody.innerHTML = `
                <tr><td colspan="9" class="text-center py-12 text-slate-400 font-bold">
                    <div class="flex flex-col items-center gap-3">
                        <i data-lucide="loader-2" class="w-8 h-8 text-slate-300 animate-spin"></i>
                        <span>جاري تحميل الحجوزات المحذوفة...</span>
                    </div>
                </td></tr>`;
            if (typeof lucide !== "undefined") lucide.createIcons();

            let records = [];
            try {
                if (CLOUD_ENABLED) {
                    const snap = await db.ref('deletedBookings').once('value');
                    const val = snap.val() || {};
                    records = Object.entries(val).map(([key, r]) => ({
                        key:        key,
                        serverTime: r.deletedAt || '',
                        deletedAt:  r.deletedAt || '',
                        deletedBy:  r.deletedBy || '',
                        deleteType: r.deleteType || '',
                        company:    r.companyName || '',
                        phone:      r.phone || '',
                        hallName:   r.hallName || '',
                        startDate:  r.startDate || '',
                        endDate:    r.endDate || '',
                        startTime:  r.startTime || '',
                        endTime:    r.endTime || '',
                        notes:      r.notes || '',
                        bookingId:  r.bookingId || '',
                        groupId:    r.groupId || ''
                    }));
                }
            } catch (e) {
                // في حالة الخطأ نعرض القائمة فارغة بدل تعطيل الواجهة
                records = [];
            }

            // ترتيب من الأحدث للأقدم
            records.sort((a, b) => {
                const tsA = a.deletedAt || '';
                const tsB = b.deletedAt || '';
                if (tsA && tsB) return tsB.localeCompare(tsA);
                if (tsA) return -1;
                if (tsB) return 1;
                return 0;
            });

            window._allDeletedBookings = records;

            const searchInput = document.getElementById('deletedBookingsSearchInput');
            if (searchInput) searchInput.value = '';

            renderDeletedBookingsTable(records);
        }

        function renderDeletedBookingsTable(records) {
            const tbody = document.getElementById('deletedBookingsTableBody');
            const badge = document.getElementById('deletedBookingsCountBadge');
            if (badge) badge.textContent = records.length + ' حجز محذوف';
            const isAdminUser = state.currentUserEmail === ADMIN_EMAIL;

            if (!records || records.length === 0) {
                tbody.innerHTML = `
                    <tr><td colspan="9" class="text-center py-16 text-slate-400 font-bold">
                        <div class="flex flex-col items-center gap-3">
                            <i data-lucide="inbox" class="w-12 h-12 text-slate-300"></i>
                            <span>لا توجد حجوزات محذوفة حتى الآن</span>
                        </div>
                    </td></tr>`;
                if (typeof lucide !== "undefined") lucide.createIcons();
                return;
            }

            const fmtDate = d => d ? String(d).split('-').reverse().join('/') : '—';

            tbody.innerHTML = records.map((r, i) => {
                let tsDate = '—', tsTime = '';
                if (r.deletedAt) {
                    try {
                        const d = new Date(r.deletedAt);
                        tsDate = d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
                        tsTime = d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                    } catch (e) { /* تجاهل */ }
                }

                const dateRange = r.startDate
                    ? (r.endDate && r.endDate !== r.startDate ? `${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}` : fmtDate(r.startDate))
                    : '—';

                const typeColor = r.deleteType === 'الحجز بالكامل'
                    ? 'bg-red-100 text-red-700 border border-red-200'
                    : 'bg-orange-100 text-orange-700 border border-orange-200';

                return `
                    <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50 group">
                        <td class="px-3 py-3 text-center w-8">
                            <input type="checkbox" class="deletedBookingRowCheckbox w-4 h-4 rounded border-slate-300 accent-[#6E1418] cursor-pointer" data-key="${r.key}" onchange="updateDeletedBookingsSelectAllState()">
                        </td>
                        <td class="px-3 py-3 text-xs font-bold text-slate-300 text-center w-8 group-hover:text-slate-500">${records.length - i}</td>
                        <td class="px-3 py-3">
                            <span class="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-lg ${typeColor} whitespace-nowrap">
                                <i data-lucide="trash-2" class="w-3 h-3 shrink-0"></i>
                                ${r.deleteType || '—'}
                            </span>
                        </td>
                        <td class="px-3 py-3 font-bold text-[#6E1418] text-sm max-w-[160px]">
                            <div class="truncate" title="${(r.company || '').replace(/"/g, '&quot;')}">${r.company || '—'}</div>
                        </td>
                        <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap" style="direction:ltr; text-align:right;">${r.phone || '—'}</td>
                        <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap">${r.hallName || '—'}</td>
                        <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap">${dateRange}</td>
                        <td class="px-3 py-3">
                            <div class="font-bold text-slate-700 text-sm">${tsDate}</div>
                            <div class="text-xs text-slate-400 font-mono mt-0.5">${tsTime}</div>
                        </td>
                        <td class="px-3 py-3">
                            <div class="flex items-center gap-2">
                                <div class="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0 text-slate-500 font-black text-xs border border-slate-200">
                                    ${r.deletedBy ? r.deletedBy.charAt(0).toUpperCase() : '?'}
                                </div>
                                <span class="text-xs font-bold text-slate-600 break-all" style="direction:ltr; max-width:160px;" title="${r.deletedBy || ''}">${r.deletedBy || '—'}</span>
                            </div>
                        </td>
                        ${isAdminUser ? `
                        <td class="px-3 py-3 text-center">
                            <button onclick="deleteDeletedBookingRecord('${r.key}')" class="w-8 h-8 inline-flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="حذف هذا السجل نهائياً">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </td>` : ''}
                    </tr>
                `;
            }).join('');

            if (typeof lucide !== "undefined") lucide.createIcons();

            const selectAllBox = document.getElementById('deletedBookingsSelectAll');
            if (selectAllBox) selectAllBox.checked = false;
            updateDeletedBookingsSelectAllState();
        }

        // تحديد / إلغاء تحديد كل الصفوف الظاهرة حالياً في جدول الحجوزات المحذوفة
        function toggleSelectAllDeletedBookings(checkbox) {
            document.querySelectorAll('.deletedBookingRowCheckbox').forEach(cb => {
                cb.checked = checkbox.checked;
            });
            updateDeletedBookingsSelectAllState();
        }

        // مزامنة حالة "تحديد الكل" وعدّاد الأزرار عند تغيير أي checkbox فردي
        function updateDeletedBookingsSelectAllState() {
            const rowBoxes = document.querySelectorAll('.deletedBookingRowCheckbox');
            const selectAllBox = document.getElementById('deletedBookingsSelectAll');
            if (selectAllBox) {
                selectAllBox.checked = rowBoxes.length > 0 && Array.from(rowBoxes).every(cb => cb.checked);
            }
            const checkedCount = document.querySelectorAll('.deletedBookingRowCheckbox:checked').length;
            const countEl = document.getElementById('deletedBookingsSelectedCount');
            if (countEl) countEl.textContent = checkedCount;
            const bulkBtn = document.getElementById('deletedBookingsBulkDeleteBtn');
            if (bulkBtn && state.currentUserEmail === ADMIN_EMAIL) {
                bulkBtn.disabled = checkedCount === 0;
                bulkBtn.classList.toggle('opacity-50', checkedCount === 0);
                bulkBtn.classList.toggle('cursor-not-allowed', checkedCount === 0);
            }
        }

        function filterDeletedBookings() {
            const q = (document.getElementById('deletedBookingsSearchInput').value || '').trim().toLowerCase();
            if (!window._allDeletedBookings) return;
            const filtered = !q
                ? window._allDeletedBookings
                : window._allDeletedBookings.filter(r =>
                    (r.company    || '').toLowerCase().includes(q) ||
                    (r.phone      || '').toLowerCase().includes(q) ||
                    (r.hallName   || '').toLowerCase().includes(q) ||
                    (r.deletedBy  || '').toLowerCase().includes(q) ||
                    (r.deleteType || '').toLowerCase().includes(q) ||
                    (r.startDate  || '').toLowerCase().includes(q)
                );
            renderDeletedBookingsTable(filtered);
        }

        // حذف سجل حجز محذوف نهائياً من عقدة deletedBookings (للأدمن فقط)
        async function deleteDeletedBookingRecord(key) {
            if (state.currentUserEmail !== ADMIN_EMAIL) return;
            if (!key) return;
            if (!confirm('هل أنت متأكد من حذف هذا السجل نهائياً من سجل الحجوزات المحذوفة؟\nلا يمكن التراجع عن هذا الإجراء.')) return;

            try {
                if (CLOUD_ENABLED) {
                    await db.ref('deletedBookings/' + key).remove();
                }
                if (window._allDeletedBookings) {
                    window._allDeletedBookings = window._allDeletedBookings.filter(r => r.key !== key);
                }
                filterDeletedBookings();
                showToast('تم حذف السجل نهائياً', 'success');
            } catch (err) {
                console.error('Delete deleted-booking record error:', err);
                showToast('حدث خطأ أثناء حذف السجل: ' + err.message, 'error');
            }
        }

        // حذف مجموعة سجلات محددة دفعة واحدة من عقدة deletedBookings (للأدمن فقط)
        async function deleteSelectedDeletedBookings() {
            if (state.currentUserEmail !== ADMIN_EMAIL) return;
            const keys = Array.from(document.querySelectorAll('.deletedBookingRowCheckbox:checked'))
                .map(cb => cb.dataset.key)
                .filter(Boolean);
            if (keys.length === 0) return;
            if (!confirm(`هل أنت متأكد من حذف ${keys.length} سجل نهائياً من سجل الحجوزات المحذوفة؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

            try {
                if (CLOUD_ENABLED) {
                    const updates = {};
                    keys.forEach(k => { updates['deletedBookings/' + k] = null; });
                    await db.ref().update(updates);
                }
                if (window._allDeletedBookings) {
                    const keysSet = new Set(keys);
                    window._allDeletedBookings = window._allDeletedBookings.filter(r => !keysSet.has(r.key));
                }
                filterDeletedBookings();
                showToast(`تم حذف ${keys.length} سجل نهائياً`, 'success');
            } catch (err) {
                console.error('Bulk delete deleted-bookings error:', err);
                showToast('حدث خطأ أثناء حذف السجلات المحددة: ' + err.message, 'error');
            }
        }

        // ─── الأرشيف الشهري ─────────────────────────────────────────────
        // الفكرة: بدل تحميل كل الحجوزات (بما فيها الشهور القديمة) في كل مرة يُفتح
        // فيها التطبيق، يمكن أرشفة شهر كامل بكل تفاصيله في عقدة منفصلة بالسحابة
        // (archive/{monthKey})، فتُحذف من عقدة bookings الرئيسية التي تُحمَّل دائماً،
        // ولا يتم تحميل بيانات الأرشيف إلا عند فتح نافذة الأرشيف صراحة أو عرض شهر بعينه.
        function monthKeyOf(dateStr) {
            return (dateStr || '').slice(0, 7); // "YYYY-MM"
        }

        function monthKeyLabel(monthKey) {
            const parts = (monthKey || '').split('-').map(Number);
            const y = parts[0], m = parts[1];
            if (!y || !m) return monthKey;
            const d = new Date(y, m - 1, 1);
            return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
        }

        function currentMonthKey() {
            const now = new Date();
            return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        // الأشهر القابلة للأرشفة: أشهر ماضية بالكامل (قبل الشهر الحالي) وبها حجوزات نشطة
        function getArchivableMonths() {
            const nowKey = currentMonthKey();
            const counts = {};
            state.bookings.forEach(b => {
                const mk = monthKeyOf(b.startDate);
                if (!mk || mk >= nowKey) return;
                counts[mk] = (counts[mk] || 0) + 1;
            });
            return Object.entries(counts)
                .map(([monthKey, count]) => ({ monthKey, count }))
                .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
        }

        // خاصية الأرشفة/الاستعادة/الحذف النهائي مقصورة على الأدمن فقط.
        // بقية المستخدمين والزوار يمكنهم فقط تصفح الأرشيف وعرض تفاصيله.
        function isArchiveAdmin() {
            return state.currentUserEmail === ADMIN_EMAIL;
        }

        async function toggleArchiveModal() {
            const modal = document.getElementById('archiveModal');
            const newSection = document.getElementById('archiveNewSection');
            if (newSection) newSection.style.display = isArchiveAdmin() ? '' : 'none';
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
                if (typeof lucide !== "undefined") lucide.createIcons();
                if (isArchiveAdmin()) populateArchivableMonthsSelect();
                await loadArchiveIndex();
            } else {
                modal.classList.add('hidden');
            }
        }

        function populateArchivableMonthsSelect() {
            const select = document.getElementById('archiveMonthSelect');
            if (!select) return;
            const months = getArchivableMonths();
            if (months.length === 0) {
                select.innerHTML = `<option value="">لا توجد أشهر سابقة قابلة للأرشفة</option>`;
                select.disabled = true;
                return;
            }
            select.disabled = false;
            select.innerHTML = months.map(m =>
                `<option value="${m.monthKey}">${monthKeyLabel(m.monthKey)} — ${m.count} حجز</option>`
            ).join('');
        }

        function confirmArchiveSelectedMonth() {
            if (!isArchiveAdmin()) return;
            const select = document.getElementById('archiveMonthSelect');
            const monthKey = select && select.value;
            if (!monthKey) return;
            const label = monthKeyLabel(monthKey);
            const count = state.bookings.filter(b => monthKeyOf(b.startDate) === monthKey).length;
            if (count === 0) return;
            if (!confirm(
                `سيتم أرشفة ${count} حجز من شهر ${label}.\n` +
                `ستُنقل هذه الحجوزات خارج القائمة النشطة لتسريع فتح التطبيق، ويمكن الاطلاع عليها أو استعادتها من الأرشيف في أي وقت.\n\n` +
                `هل تريد المتابعة؟`
            )) return;
            archiveMonthNow(monthKey, label);
        }

        async function archiveMonthNow(monthKey, label) {
            if (!isArchiveAdmin()) return;
            const toArchive = state.bookings.filter(b => monthKeyOf(b.startDate) === monthKey);
            if (toArchive.length === 0) { showToast('لا توجد حجوزات في هذا الشهر', 'error'); return; }

            showSync(`جاري أرشفة شهر ${label} ...`);
            try {
                const meta = {
                    monthKey,
                    label,
                    count: toArchive.length,
                    archivedAt: new Date().toISOString(),
                    archivedBy: state.currentUserEmail || ''
                };
                // نكتب أولاً نسخة الأرشيف الكاملة، ثم فهرس خفيف منفصل يُستخدم لعرض
                // قائمة الأشهر المؤرشفة دون الحاجة لتحميل كل تفاصيل الحجوزات
                await Promise.all([
                    db.ref('archive/' + monthKey).set(toArchive),
                    db.ref('archiveIndex/' + monthKey).set(meta)
                ]);

                // إزالتها من القائمة النشطة محلياً. لازم تُسجَّل كـ"حذف معلّق" (نفس آلية
                // حذف الحجوزات العادية) وإلا فمنطق المزامنة هيرجعها تاني من نسخة السحابة
                // القديمة لعقدة bookings، لأنها لسه موجودة هناك ولم تُعتبر "معدّلة محليًا"
                toArchive.forEach(b => state.pendingDeletions.push(b.id));
                state.bookings = state.bookings.filter(b => monthKeyOf(b.startDate) !== monthKey);
                saveLocal();

                showToast(`تمت أرشفة ${toArchive.length} حجز من شهر ${label} ✓`, 'success');
                populateArchivableMonthsSelect();
                await loadArchiveIndex();
                render();
                if (!document.getElementById('archiveModal').classList.contains('hidden')) {
                    document.getElementById('archiveModal').classList.remove('hidden');
                }
            } catch (e) {
                console.error(e);
                showSync("فشلت الأرشفة: " + e.message, true);
            } finally {
                setTimeout(() => { const s = document.getElementById('sync-status'); if (s) s.style.display = 'none'; }, 3000);
            }
        }

        async function loadArchiveIndex() {
            const container = document.getElementById('archivedMonthsList');
            if (!container) return;
            container.innerHTML = `
                <div class="text-center py-8 text-slate-400 font-bold flex flex-col items-center gap-3">
                    <i data-lucide="loader-2" class="w-7 h-7 text-slate-300 animate-spin"></i>
                    <span>جاري تحميل قائمة الأشهر المؤرشفة...</span>
                </div>`;
            if (typeof lucide !== "undefined") lucide.createIcons();

            let months = [];
            try {
                const snap = await db.ref('archiveIndex').once('value');
                const val = snap.val() || {};
                months = Object.values(val);
            } catch (e) {
                months = [];
            }
            months.sort((a, b) => (b.monthKey || '').localeCompare(a.monthKey || ''));
            window._allArchivedMonths = months;
            renderArchivedMonthsList(months);
        }

        function renderArchivedMonthsList(months) {
            const container = document.getElementById('archivedMonthsList');
            if (!container) return;

            if (!months || months.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-10 text-slate-400 font-bold flex flex-col items-center gap-3">
                        <i data-lucide="archive" class="w-10 h-10 text-slate-300"></i>
                        <span>لا توجد أشهر مؤرشفة حتى الآن</span>
                    </div>`;
                if (typeof lucide !== "undefined") lucide.createIcons();
                return;
            }

            container.innerHTML = months.map(m => {
                let archivedDate = '—';
                try {
                    archivedDate = new Date(m.archivedAt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
                } catch (e) { /* تجاهل */ }

                return `
                <div class="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-4 hover:border-[#A88A45]/40 hover:shadow-sm transition-all">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 border border-amber-100">
                            <i data-lucide="archive" class="w-5 h-5 text-[#A88A45]"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="font-black text-[#6E1418] text-sm">${m.label || m.monthKey}</div>
                            <div class="text-xs text-slate-400 font-medium mt-0.5">${m.count || 0} حجز · أُرشف في ${archivedDate}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5 shrink-0">
                        <button onclick="viewArchivedMonth('${m.monthKey}')" class="p-2 text-slate-500 hover:text-[#6E1418] hover:bg-slate-100 rounded-xl transition-all" title="عرض التفاصيل">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                        </button>
                        ${isArchiveAdmin() ? `
                        <button onclick="restoreArchivedMonth('${m.monthKey}')" class="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all" title="استعادة إلى القائمة النشطة">
                            <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
                        </button>
                        <button onclick="deleteArchivedMonthPermanently('${m.monthKey}')" class="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="حذف نهائي">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                        ` : ''}
                    </div>
                </div>`;
            }).join('');

            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        async function viewArchivedMonth(monthKey) {
            const modal = document.getElementById('archiveDetailModal');
            modal.classList.remove('hidden');
            modal.dataset.monthKey = monthKey;
            document.getElementById('archiveDetailTitle').textContent = monthKeyLabel(monthKey) + ' (مؤرشف)';
            const restoreBtn = document.getElementById('archiveDetailRestoreBtn');
            if (restoreBtn) restoreBtn.style.display = isArchiveAdmin() ? '' : 'none';

            const tbody = document.getElementById('archiveDetailTableBody');
            tbody.innerHTML = `
                <tr><td colspan="7" class="text-center py-12 text-slate-400 font-bold">
                    <div class="flex flex-col items-center gap-3">
                        <i data-lucide="loader-2" class="w-8 h-8 text-slate-300 animate-spin"></i>
                        <span>جاري تحميل التفاصيل...</span>
                    </div>
                </td></tr>`;
            if (typeof lucide !== "undefined") lucide.createIcons();

            let records = [];
            try {
                const snap = await db.ref('archive/' + monthKey).once('value');
                records = fbValToArray(snap.val());
            } catch (e) {
                records = [];
            }
            records.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
            renderArchiveDetailTable(records);
        }

        function renderArchiveDetailTable(records) {
            const tbody = document.getElementById('archiveDetailTableBody');
            if (!records || records.length === 0) {
                tbody.innerHTML = `
                    <tr><td colspan="7" class="text-center py-16 text-slate-400 font-bold">
                        <div class="flex flex-col items-center gap-3">
                            <i data-lucide="inbox" class="w-12 h-12 text-slate-300"></i>
                            <span>لا توجد بيانات</span>
                        </div>
                    </td></tr>`;
                if (typeof lucide !== "undefined") lucide.createIcons();
                return;
            }

            const fmtDate = d => d ? String(d).split('-').reverse().join('/') : '—';

            tbody.innerHTML = records.map((b, i) => {
                const hall = HALLS.find(h => h.id === b.hallId);
                return `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50">
                    <td class="px-3 py-3 text-xs font-bold text-slate-300 text-center w-8">${i + 1}</td>
                    <td class="px-3 py-3 font-bold text-[#6E1418] text-sm max-w-[160px]">
                        <div class="truncate" title="${escapeHtml(b.companyName)}">${escapeHtml(b.companyName) || '—'}</div>
                    </td>
                    <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap" style="direction:ltr; text-align:right;">${b.phone ? `<span class="inline-flex items-center gap-1.5"><span>${escapeHtml(b.phone)}</span><a href="${getWhatsAppLink(b.phone)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="واتساب ${escapeHtml(b.phone)}" class="inline-flex items-center justify-center w-5 h-5 shrink-0 hover:opacity-70 transition-opacity"><svg viewBox="0 0 24 24" class="w-3.5 h-3.5 fill-green-600"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2m0 1.67a8.2 8.2 0 018.24 8.24c0 4.55-3.7 8.24-8.25 8.24a8.2 8.2 0 01-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.18 8.18 0 01-1.26-4.38c0-4.55 3.7-8.24 8.25-8.24m-4.53 4.72c-.16 0-.42.06-.64.31s-.85.83-.85 2.03.87 2.36.99 2.52c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.19 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28s-1.44-.71-1.66-.79-.39-.12-.55.12c-.16.24-.63.79-.77.95-.14.16-.28.18-.53.06-.24-.12-1.02-.38-1.95-1.2-.72-.64-1.2-1.44-1.35-1.68-.14-.24-.02-.37.11-.5.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.35-.76-1.84-.2-.48-.4-.42-.55-.42h-.47" /></svg></a></span>` : '—'}</td>
                    <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap">${hall ? hall.name : (b.hallName || '—')}</td>
                    <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap">${fmtDate(b.startDate)}${b.endDate && b.endDate !== b.startDate ? ' → ' + fmtDate(b.endDate) : ''}</td>
                    <td class="px-3 py-3 text-sm font-medium text-slate-600 whitespace-nowrap">${b.startTime || ''}${b.endTime ? ' - ' + b.endTime : ''}</td>
                    <td class="px-3 py-3 text-sm text-slate-600 max-w-[220px]">
                        <div class="truncate" title="${escapeHtml(b.notes)}">${escapeHtml(b.notes) || '—'}</div>
                    </td>
                </tr>`;
            }).join('');

            if (typeof lucide !== "undefined") lucide.createIcons();
        }

        async function restoreArchivedMonth(monthKey) {
            if (!isArchiveAdmin()) return;
            if (!monthKey) return;
            const label = monthKeyLabel(monthKey);
            if (!confirm(`سيتم استعادة جميع حجوزات شهر ${label} إلى القائمة النشطة وحذفها من الأرشيف.\n\nهل تريد المتابعة؟`)) return;

            showSync(`جاري استعادة شهر ${label} ...`);
            try {
                const snap = await db.ref('archive/' + monthKey).once('value');
                const records = fbValToArray(snap.val());
                if (records.length === 0) { showSync("لا توجد بيانات لاستعادتها", true); return; }

                // نعلّمها كـ"معدَّلة محليًا" (_isDirty) وإلا فمنطق المزامنة هيتجاهلها
                // ويعتبر نسخة السحابة الحالية (اللي ملهاش هذه الحجوزات) هي الصح
                const existingIds = new Set(state.bookings.map(b => String(b.id)));
                records.forEach(r => { if (!existingIds.has(String(r.id))) state.bookings.push({ ...r, _isDirty: true }); });

                await Promise.all([
                    db.ref('archive/' + monthKey).remove(),
                    db.ref('archiveIndex/' + monthKey).remove()
                ]);

                saveLocal();
                showToast(`تمت استعادة ${records.length} حجز من شهر ${label} ✓`, 'success');
                document.getElementById('archiveDetailModal').classList.add('hidden');
                populateArchivableMonthsSelect();
                await loadArchiveIndex();
                render();
            } catch (e) {
                console.error(e);
                showSync("فشلت الاستعادة: " + e.message, true);
            } finally {
                setTimeout(() => { const s = document.getElementById('sync-status'); if (s) s.style.display = 'none'; }, 3000);
            }
        }

        async function deleteArchivedMonthPermanently(monthKey) {
            if (!isArchiveAdmin()) return;
            const label = monthKeyLabel(monthKey);
            if (!confirm(`تحذير: سيتم حذف جميع حجوزات شهر ${label} نهائياً من الأرشيف ولن يمكن التراجع عن ذلك.\n\nهل أنت متأكد؟`)) return;
            if (!confirm(`تأكيد أخير: سيتم فقدان بيانات شهر ${label} نهائياً. هل تريد المتابعة؟`)) return;

            try {
                await Promise.all([
                    db.ref('archive/' + monthKey).remove(),
                    db.ref('archiveIndex/' + monthKey).remove()
                ]);
                showToast(`تم حذف أرشيف شهر ${label} نهائياً`, 'success');
                await loadArchiveIndex();
            } catch (e) {
                console.error(e);
                showToast("فشل الحذف: " + e.message, 'error');
            }
        }

        // ─── Print Upcoming Bookings ───────────────────────────────────────
        function printUpcomingBookings() {
            const today = new Date().toISOString().split('T')[0];
            const upcoming = [...state.bookings]
                .filter(b => b.startDate >= today)
                .sort((a, b) => {
                    if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
                    return (a.startTime || '').localeCompare(b.startTime || '');
                });

            if (upcoming.length === 0) {
                showToast('لا توجد حجوزات قادمة للطباعة', 'error');
                return;
            }

            // Deduplicate by groupId — show each booking group once
            const seen = new Set();
            const uniqueUpcoming = upcoming.filter(b => {
                const key = b.groupId || b.id.toString().split('_d')[0];
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            const printDate = new Date().toLocaleDateString('ar-EG', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            const fmtDate = d => d ? d.split('-').reverse().join('/') : '-';

            const rows = uniqueUpcoming.map((b, i) => {
                const hall = HALLS.find(h => h.id === b.hallId) || { name: b.hallId || 'غير معروف' };

                // Determine actual range from group
                let startDate = b.startDate, endDate = b.endDate || b.startDate;
                if (b.originalRange && b.originalRange.includes(' to ')) {
                    const p = b.originalRange.split(' to ');
                    startDate = p[0]; endDate = p[1];
                } else {
                    const gKey = b.groupId || b.id.toString().split('_d')[0];
                    const groupDays = state.bookings
                        .filter(x => (x.groupId === gKey) || (x.id === gKey))
                        .map(x => x.startDate).sort();
                    if (groupDays.length > 0) {
                        startDate = groupDays[0];
                        endDate   = groupDays[groupDays.length - 1];
                    }
                }

                const dateDisplay = startDate !== endDate
                    ? fmtDate(startDate) + ' ← ' + fmtDate(endDate)
                    : fmtDate(startDate);

                const timeDisplay = (b.startTime && b.endTime)
                    ? b.startTime + ' – ' + b.endTime
                    : (b.startTime || 'يوم كامل');

                const notesDisplay = (b.notes || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const employeeDisplay = b.employee || '-';

                return `
                    <tr>
                        <td class="num">${i + 1}</td>
                        <td class="company">${b.companyName || '-'}</td>
                        <td class="hall">${hall.name}</td>
                        <td class="date">${dateDisplay}</td>
                        <td class="time">${timeDisplay}</td>
                        <td class="emp">${employeeDisplay}</td>
                        <td class="notes">${notesDisplay || '—'}</td>
                    </tr>
                `;
            }).join('');

            const printHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>الحجوزات القادمة – رستا بورسعيد</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
        font-family: 'Noto Sans Arabic', sans-serif;
        background: #ffffff;
        color: #1e293b;
        direction: rtl;
        padding: 24px 28px;
        font-size: 13px;
    }
    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 3px solid #6E1418;
    }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .logo-box {
        width: 48px; height: 48px;
        background: linear-gradient(135deg, #6E1418, #8a1c22);
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        color: white; font-size: 22px; font-weight: 900;
    }
    .hotel-name { font-size: 20px; font-weight: 900; color: #6E1418; }
    .hotel-sub { font-size: 12px; color: #94a3b8; font-weight: 600; margin-top: 2px; }
    .meta-area { text-align: left; }
    .print-date-label { font-size: 11px; color: #94a3b8; font-weight: 600; }
    .print-date-val { font-size: 13px; font-weight: 700; color: #475569; margin-top: 2px; }
    .count-badge {
        display: inline-block;
        background: #6E1418; color: white;
        padding: 5px 16px; border-radius: 20px;
        font-size: 12px; font-weight: 800;
        margin-top: 6px;
    }
    .section-title {
        font-size: 15px; font-weight: 900;
        color: #334155;
        margin-bottom: 12px;
        display: flex; align-items: center; gap: 8px;
    }
    .section-title::before {
        content: '';
        display: inline-block;
        width: 4px; height: 18px;
        background: #A88A45;
        border-radius: 4px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12.5px;
    }
    thead { background: #6E1418; color: white; }
    thead th {
        padding: 10px 8px;
        font-weight: 800;
        font-size: 11.5px;
        text-align: right;
        letter-spacing: 0.3px;
        white-space: nowrap;
    }
    thead th:first-child { border-radius: 0 8px 8px 0; text-align: center; }
    thead th:last-child  { border-radius: 8px 0 0 8px; }
    tbody tr { border-bottom: 1px solid #f1f5f9; }
    tbody tr:nth-child(even) { background: #fafafa; }
    tbody tr:hover { background: #fff8f0; }
    tbody td { padding: 9px 8px; vertical-align: top; }
    td.num { font-weight: 700; color: #94a3b8; text-align: center; width: 36px; }
    td.company { font-weight: 900; color: #6E1418; min-width: 120px; }
    td.hall { font-weight: 700; color: #475569; white-space: nowrap; }
    td.date { font-family: monospace; color: #334155; white-space: nowrap; font-size: 12px; }
    td.time { font-family: monospace; color: #475569; white-space: nowrap; font-size: 12px; }
    td.emp  { color: #64748b; font-size: 12px; }
    td.notes { color: #64748b; font-size: 11.5px; max-width: 180px; }
    .footer {
        margin-top: 20px;
        padding-top: 12px;
        border-top: 1px solid #e2e8f0;
        display: flex;
        justify-content: space-between;
        font-size: 10.5px;
        color: #94a3b8;
        font-weight: 600;
    }
    @media print {
        body { padding: 0; }
        @page { size: A4 landscape; margin: 12mm 14mm; }
        thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .count-badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
</style>
</head>
<body>
<div class="page-header">
    <div class="logo-area">
        <div class="logo-box">R</div>
        <div>
            <div class="hotel-name">رستا بورسعيد</div>
            <div class="hotel-sub">Resta Port Said Hotel</div>
        </div>
    </div>
    <div class="meta-area">
        <div class="print-date-label">تاريخ الطباعة</div>
        <div class="print-date-val">${printDate}</div>
        <div class="count-badge">${uniqueUpcoming.length} حجز قادم</div>
    </div>
</div>
<div class="section-title">قائمة الحجوزات القادمة</div>
<table>
    <thead>
        <tr>
            <th>#</th>
            <th>الشركة / الجهة</th>
            <th>القاعة</th>
            <th>التاريخ</th>
            <th>الوقت</th>
            <th>الموظف</th>
            <th>ملاحظات</th>
        </tr>
    </thead>
    <tbody>${rows}</tbody>
</table>
<div class="footer">
    <span>نظام إدارة حجوزات رستا – Resta Events Booking System</span>
    <span>${printDate}</span>
</div>
<script>
    window.onload = function() {
        setTimeout(function() { window.print(); }, 600);
    };
<\/script>
</body>
</html>`;

            const win = window.open('', '_blank', 'width=1050,height=750,scrollbars=yes');
            if (!win) {
                showToast('يرجى السماح بفتح النوافذ المنبثقة في المتصفح', 'error');
                return;
            }
            win.document.write(printHtml);
            win.document.close();
        }

        // ─── Backup & Restore ──────────────────────────────────────────────────

        // --- تصدير نسخة احتياطية كاملة ---
        async function exportBackup() {
            showSync('جاري تجهيز النسخة الاحتياطية...');
            try {
                // نجلب أحدث بيانات من Firebase مباشرة
                const snapshot = await fetchCloudSnapshot();
                const backup = {
                    _backupMeta: {
                        exportedAt: new Date().toISOString(),
                        exportedBy: state.currentUserEmail,
                        version: '1.0',
                        app: 'Resta Events Booking System'
                    },
                    bookings: snapshot.bookings || [],
                    logs: snapshot.logs || [],
                    users: snapshot.users || [],
                    updatedAt: snapshot.updatedAt || null
                };

                const json = JSON.stringify(backup, null, 2);
                const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const fileName = `resta-backup-${dateStr}.json`;

                // Blob + رابط تحميل مباشر (يعمل على جميع الأجهزة والمتصفحات وتطبيقات الأندرويد)
                let downloaded = false;
                try {
                    const blob = new Blob([json], { type: 'application/json' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 3000);
                    downloaded = true;
                } catch (_) {}

                // إذا فشل Blob (نادراً) — نعرض نافذة نسخ يدوي
                if (!downloaded) {
                    showBackupCopyModal(json, fileName);
                    return;
                }

                showToast(
                    `✅ تم تصدير النسخة الاحتياطية (${backup.bookings.length} حجز، ${backup.logs.length} سجل)`,
                    'success'
                );
            } catch (err) {
                console.error('Backup export error:', err);
                showToast('حدث خطأ أثناء تصدير النسخة الاحتياطية: ' + err.message, 'error');
            }
        }

        // --- تصدير نسخة احتياطية كاملة (تشمل الحجوزات النشطة + كل الأشهر المؤرشفة) ---
        async function exportFullBackup() {
            showSync('جاري تجهيز النسخة الاحتياطية الكاملة (شاملة الأرشيف)...');
            try {
                // نجلب أحدث بيانات من Firebase مباشرة
                const snapshot = await fetchCloudSnapshot();

                // نجلب فهرس الأشهر المؤرشفة، ثم كل شهر مؤرشف بالتفصيل
                const archiveIndexSnap = await db.ref('archiveIndex').once('value');
                const archiveIndexVal = archiveIndexSnap.val() || {};
                const monthKeys = Object.keys(archiveIndexVal);

                const archiveData = {};
                if (monthKeys.length) {
                    const archiveSnaps = await Promise.all(
                        monthKeys.map(mk => db.ref('archive/' + mk).once('value'))
                    );
                    monthKeys.forEach((mk, i) => {
                        archiveData[mk] = fbValToArray(archiveSnaps[i].val());
                    });
                }

                const backup = {
                    _backupMeta: {
                        exportedAt: new Date().toISOString(),
                        exportedBy: state.currentUserEmail,
                        version: '1.0',
                        app: 'Resta Events Booking System',
                        type: 'full'
                    },
                    bookings: snapshot.bookings || [],
                    logs: snapshot.logs || [],
                    users: snapshot.users || [],
                    updatedAt: snapshot.updatedAt || null,
                    archive: archiveData,
                    archiveIndex: archiveIndexVal
                };

                const json = JSON.stringify(backup, null, 2);
                const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const fileName = `resta-backup-full-${dateStr}.json`;

                // Blob + رابط تحميل مباشر (يعمل على جميع الأجهزة والمتصفحات وتطبيقات الأندرويد)
                let downloaded = false;
                try {
                    const blob = new Blob([json], { type: 'application/json' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = fileName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 3000);
                    downloaded = true;
                } catch (_) {}

                // إذا فشل Blob (نادراً) — نعرض نافذة نسخ يدوي
                if (!downloaded) {
                    showBackupCopyModal(json, fileName);
                    return;
                }

                const archivedBookingsCount = Object.values(archiveData).reduce((sum, arr) => sum + arr.length, 0);
                showToast(
                    `✅ تم تصدير النسخة الكاملة (${backup.bookings.length} حجز نشط، ${monthKeys.length} شهر مؤرشف بإجمالي ${archivedBookingsCount} حجز مؤرشف)`,
                    'success'
                );
            } catch (err) {
                console.error('Full backup export error:', err);
                showToast('حدث خطأ أثناء تصدير النسخة الاحتياطية الكاملة: ' + err.message, 'error');
            }
        }

        // نافذة احتياطية: نسخ JSON يدوياً لو الموبايل حجب كل الطرق
        function showBackupCopyModal(json, fileName) {
            const existing = document.getElementById('backupCopyModal');
            if (existing) existing.remove();

            const modal = document.createElement('div');
            modal.id = 'backupCopyModal';
            modal.className = 'fixed inset-0 z-[300] flex items-center justify-center modal-backdrop p-4';
            modal.innerHTML = `
                <div class="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in border border-slate-100">
                    <div class="px-6 py-4 bg-gradient-to-l from-indigo-700 to-indigo-900 text-white flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <i data-lucide="hard-drive-download" class="w-6 h-6 text-indigo-200"></i>
                            <h3 class="font-black text-lg">النسخة الاحتياطية جاهزة</h3>
                        </div>
                        <button onclick="document.getElementById('backupCopyModal').remove()" class="w-9 h-9 flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-all">
                            <i data-lucide="x" class="w-4 h-4"></i>
                        </button>
                    </div>
                    <div class="p-5 space-y-4">
                        <p class="text-sm text-slate-600 font-medium bg-amber-50 border border-amber-200 rounded-xl p-3">
                            📱 متصفحك على الموبايل لا يدعم التحميل التلقائي. انسخ النص أدناه واحفظه في ملف باسم <strong>${fileName}</strong>
                        </p>
                        <textarea readonly rows="8" class="w-full text-xs font-mono border border-slate-200 rounded-xl p-3 bg-slate-50 outline-none resize-none dir-ltr text-left" id="backupJsonText">${json.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
                        <button onclick="
                            const t = document.getElementById('backupJsonText');
                            t.select(); t.setSelectionRange(0,99999);
                            navigator.clipboard ? navigator.clipboard.writeText(t.value).then(()=>showToast('تم النسخ ✅','success')) : document.execCommand('copy');
                        " class="w-full py-3 font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all flex items-center justify-center gap-2">
                            <i data-lucide="copy" class="w-5 h-5"></i>
                            نسخ النص كاملاً
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }

        // --- فتح منتقي الملفات لاستيراد النسخة الاحتياطية ---
        function triggerImportBackup() {
            const input = document.getElementById('backupFileInput');
            if (input) input.click();
        }

        // --- معالجة ملف النسخة الاحتياطية المختار ---
        function handleBackupFileSelected(event) {
            const file = event.target.files && event.target.files[0];
            // إعادة تعيين الـ input حتى لو اختار نفس الملف مرة أخرى
            event.target.value = '';

            if (!file) return;

            if (!file.name.endsWith('.json')) {
                showToast('يرجى اختيار ملف JSON صالح.', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = function (e) {
                let parsed;
                try {
                    parsed = JSON.parse(e.target.result);
                } catch (_) {
                    showToast('الملف المختار ليس بصيغة JSON صحيحة.', 'error');
                    return;
                }

                // تحقق بسيط من بنية الملف
                if (!parsed.bookings && !parsed.logs) {
                    showToast('هذا الملف لا يبدو نسخة احتياطية صالحة من النظام.', 'error');
                    return;
                }

                // عرض modal التأكيد ووصل callback التنفيذ
                const modal = document.getElementById('restoreConfirmModal');
                const confirmBtn = document.getElementById('restoreConfirmBtn');

                // إزالة listener قديم إن وجد
                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

                newBtn.addEventListener('click', async function() {
                    modal.classList.add('hidden');
                    await performRestore(parsed);
                });

                modal.classList.remove('hidden');
                if (typeof lucide !== 'undefined') lucide.createIcons();
            };
            reader.readAsText(file);
        }

        // --- تنفيذ الاستعادة الفعلية ---
        async function performRestore(backup) {
            showSync('جاري استعادة النسخة الاحتياطية...');
            try {
                const restoredBookings     = backup.bookings     || [];
                const restoredLogs         = backup.logs         || [];
                const restoredUsers        = backup.users        || [];
                // موجودة فقط في نسخة احتياطية "كاملة" (تصدير شامل الأرشيف) — غير موجودة في النسخة العادية
                const restoredArchive      = backup.archive      || null;
                const restoredArchiveIndex = backup.archiveIndex || null;
                const hasArchiveData = !!(restoredArchive && Object.keys(restoredArchive).length);

                // استبدال كامل في Firebase
                const restoreWrites = [
                    db.ref('bookings').set(restoredBookings.length ? restoredBookings : null),
                    db.ref('logs').set(restoredLogs.length ? restoredLogs : null),
                    db.ref('users').set(restoredUsers.length ? restoredUsers : null),
                    db.ref('meta/updatedAt').set(new Date().toISOString())
                ];
                // لو الملف المستورد نسخة كاملة تحتوي أرشيفاً، نستعيد الأرشيف أيضاً بنفس منطق الاستبدال الكامل.
                // لو الملف نسخة عادية (بدون أرشيف) لا نلمس عقدتي archive/archiveIndex إطلاقاً فتبقى كما هي.
                if (hasArchiveData) {
                    restoreWrites.push(db.ref('archive').set(restoredArchive));
                    restoreWrites.push(db.ref('archiveIndex').set(restoredArchiveIndex || null));
                }

                await Promise.all(restoreWrites);
                _lastKnownUpdatedAt = null; // أجبر الاستماع اللحظي على إعادة التحميل

                // تحديث state المحلية
                state.bookings = restoredBookings;
                state.activityLogs = restoredLogs;
                state.users = restoredUsers;
                state._opsVersion++;
                saveLocal();

                // إضافة سجل عملية الاستعادة
                state.activityLogs.unshift({
                    type:         'استعادة نسخة احتياطية',
                    company:      'النظام',
                    hallName:     '',
                    user:         state.currentUserEmail,
                    date:         new Date().toLocaleDateString('ar-EG'),
                    time:         new Date().toLocaleTimeString('ar-EG'),
                    isoTimestamp: new Date().toISOString()
                });
                await syncToCloud(true);

                render();
                showToast(
                    hasArchiveData
                        ? `✅ تمت استعادة النسخة الاحتياطية الكاملة بنجاح! (${restoredBookings.length} حجز نشط + أرشيف ${Object.keys(restoredArchive).length} شهر)`
                        : `✅ تمت استعادة النسخة الاحتياطية بنجاح! (${restoredBookings.length} حجز)`,
                    'success'
                );
            } catch (err) {
                console.error('Restore error:', err);
                showToast('حدث خطأ أثناء الاستعادة: ' + err.message, 'error');
            }
        }

