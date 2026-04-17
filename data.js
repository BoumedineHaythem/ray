// Initial Fleet Data
const initialFleet = [
    { id: 'v1', name: 'Scooter zarga', type: 'scooter', rate: 100, unit: 5, billingType: 'timer', img: 'images/scooter1.jpg', status: 'available' },
    { id: 'v2', name: 'car safra ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/car1.jpg', status: 'available' },
    { id: 'v3', name: 'car chiniya ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/care_2.jpg', status: 'available' },
    { id: 'v4', name: 'car zarga ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/car_3.jpg', status: 'available' },
    { id: 'v5', name: 'car 7amra ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/car_4.jpg', status: 'available' },
    { id: 'v6', name: 'car khadra ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/care_5.jpg', status: 'available' },
    { id: 'v7', name: 'car bayda ', type: 'car', rate: 100, unit: 1, billingType: 'flat', img: 'images/car_6.jpg', status: 'available' },
    { id: 'v8', name: 'Scooter hamra ', type: 'scooter', rate: 100, unit: 5, billingType: 'timer', img: 'images/scotore2.jpg', status: 'available' }
];

// i18n Dictionary
const translations = {
    ar: {
        appTitle: "إدارة أسطول EV",
        availableFleet: "الأسطول المتاح",
        activeSession: "الجلسات الحالية",
        history: "سجل التأجير",
        analytics: "الإحصائيات",
        fleet: "الأسطول",
        rental: "التأجير",
        rentNow: "تأجير الآن",
        endSession: "إنهاء الجلسة",
        exportCSV: "تصدير CSV",
        enterPin: "أدخل رمز PIN للوصول (الافتراضي: 1234):",
        unlock: "فتح",
        totalRevenue: "إجمالي الإيرادات",
        mostUsed: "الأكثر استخداماً",
        offline: "أنت غير متصل بالإنترنت",
        close: "إغلاق",
        available: "متاح",
        busy: "مشغول",
        duration: "المدة",
        price: "السعر",
        sessionEnded: "انتهت الجلسة وتم الدفع بنجاح. المبلغ:"
    },
    en: {
        appTitle: "EV Fleet Manager",
        availableFleet: "Available Fleet",
        activeSession: "Active Sessions",
        history: "Rental History",
        analytics: "Analytics",
        fleet: "Fleet",
        rental: "Rental",
        rentNow: "Rent Now",
        endSession: "End Session",
        exportCSV: "Export CSV",
        enterPin: "Enter PIN (Default: 1234):",
        unlock: "Unlock",
        totalRevenue: "Total Revenue",
        mostUsed: "Most Used",
        offline: "You are offline",
        close: "Close",
        available: "Available",
        busy: "Busy",
        duration: "Duration",
        price: "Price",
        sessionEnded: "Session ended and invoiced successfully. Amount:"
    }
};