/**
 * tsookly-push-proxy — وسيط بسيط بين موقع تسوكلي والويب والـ OneSignal REST API.
 *
 * ليش موجود:
 * - api.onesignal.com يرفض طلبات تجي مباشرة من متصفح (CORS)، فاستدعاءه مباشرة من
 *   جافاسكربت بصفحة الويب يفشل دايماً.
 * - استدعاءه مباشرة من المتصفح يعني لازم تحط REST API Key بكود الواجهة، وأي زائر
 *   يفتح "View Source" يقدر ياخذه ويرسل إشعارات لحسابك أو يستنزفه.
 *
 * هذا الـ Worker يستقبل طلب بسيط من صفحة الويب (بدون أي مفتاح)، ويرسل هو الطلب
 * الحقيقي لـ OneSignal من طرف السيرفر، حاملاً المفتاح من متغيرات بيئة سرّية
 * (Secrets) ما تنعرض لأحد. هذا بالضبط نفس دور OkHttp بنسخة الأندرويد.
 */

export default {
  async fetch(request, env) {
    // طلب CORS preflight (المتصفح يرسله تلقائياً قبل POST الحقيقي)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, reason: 'Method not allowed' }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ ok: false, reason: 'JSON غير صالح بالطلب' }, 400);
    }

    const { title, body, segment, externalId } = payload || {};
    if (!title || !body) {
      return json({ ok: false, reason: 'ناقص title أو body' }, 400);
    }

    // secrets محفوظة بـ Cloudflare (شوف تعليمات النشر) — ما تظهر أبداً بكود الواجهة
    const apiKey = env.ONESIGNAL_API_KEY;
    const appId = env.ONESIGNAL_APP_ID;
    if (!apiKey || !appId) {
      return json({ ok: false, reason: 'ONESIGNAL_API_KEY أو ONESIGNAL_APP_ID غير مضبوطين بإعدادات الـ Worker' }, 500);
    }

    const oneSignalBody = {
      app_id: appId,
      target_channel: 'push',
      headings: { en: title, ar: title },
      contents: { en: body, ar: body },
      priority: 10,
      ttl: 600
    };

    // إرسال لسكمنت (مثلاً كل الدلفريات) أو لزبون معيّن بالـ external_id (الإيميل)
    if (externalId) {
      oneSignalBody.include_aliases = { external_id: [externalId] };
    } else {
      oneSignalBody.included_segments = [segment || 'Drivers'];
    }

    try {
      const res = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': 'Key ' + apiKey
        },
        body: JSON.stringify(oneSignalBody)
      });

      const text = await res.text().catch(() => '');
      if (!res.ok) {
        return json({ ok: false, reason: `OneSignal ${res.status}: ${text.slice(0, 300)}` });
      }
      return json({ ok: true, reason: text.slice(0, 300) });
    } catch (e) {
      return json({ ok: false, reason: 'تعذر الوصول لـ OneSignal من السيرفر: ' + e.message }, 502);
    }
  }
};

function corsHeaders() {
  return {
    // لو تحب تحدده بنطاقك فقط بدل * (مثلاً https://your-username.github.io) زيدها هنا
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() }
  });
}
