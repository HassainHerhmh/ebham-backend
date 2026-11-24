import db from "../db.js";

const HANDOFF_CUSTOMER_TEXT =
  "أعتذر منك، يبدو أن مشكلتك تحتاج متابعة من فريق خدمة العملاء. حولت محادثتك إلى أحد الموظفين، وسيتم الرد عليك قريباً.";

export const WELCOME_TEXT =
  "يا هلا فيك في جو 👋 كيف أقدر أساعدك؟ تقدر تسأل عن طلبك، المحلات، التوصيل، أو طريقة الطلب.";

export const AI_RESUME_TEXT = "موظف الذكاء في خدمتك";
export const AI_RESUME_TEXT_OLD = "حالياً موظف الذكاء في خدمتك";
export const AGENT_RESUME_TEXT = "موظف خدمة العملاء في خدمتك";

export function isAiResumeNotice(text) {
  const value = String(text || "").trim();
  return value === AI_RESUME_TEXT || value === AI_RESUME_TEXT_OLD;
}

export function isAgentResumeNotice(text) {
  return String(text || "").trim() === AGENT_RESUME_TEXT;
}

export function isSupportSessionNotice(text) {
  return isAiResumeNotice(text) || isAgentResumeNotice(text);
}

export function isGreeting(text) {
  const value = String(text || "")
    .trim()
    .replace(/[!.؟?,،]/g, "");
  return /^(هلو|هلا|هلاو|اهلا|أهلا|مرحبا|مرحباً|السلام عليكم|السلام|سلام|هاي|hi|hello|hey|صباح الخير|مساء الخير)$/i.test(
    value
  );
}

const ORDER_STATUS_AR = {
  pending: "قيد الانتظار",
  accepted: "مقبول",
  processing: "قيد التجهيز",
  preparing: "قيد التجهيز",
  ready: "جاهز",
  delivering: "جاري التوصيل",
  completed: "مكتمل",
  cancelled: "ملغي",
  canceled: "ملغي",
};

function orderStatusAr(status) {
  const key = String(status || "").toLowerCase();
  return ORDER_STATUS_AR[key] || status || "غير معروف";
}

const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const BRANCH_DAYS = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function getYemenNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Aden" }));
}

function formatTime12Ar(value) {
  if (!value) return null;
  const [hoursPart, minutesPart = "00"] = String(value).split(":");
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return String(value);
  const period = hours >= 12 ? "مساءً" : "صباحاً";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function parseTimeMinutes(value) {
  if (!value || !String(value).includes(":")) return null;
  const [hours, minutes] = String(value).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function isOpenAtRange(from, to, closed, date) {
  if (Number(closed) === 1) return false;
  const openMinutes = parseTimeMinutes(from);
  const closeMinutesRaw = parseTimeMinutes(to);
  if (openMinutes === null || closeMinutesRaw === null) return false;
  if (openMinutes === closeMinutesRaw) return true;
  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  if (closeMinutesRaw > openMinutes) {
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutesRaw;
  }
  return currentMinutes >= openMinutes || currentMinutes <= closeMinutesRaw;
}

async function getHoursData(branchId, restaurantQuery = "") {
  const now = getYemenNow();
  const branchDay = (now.getDay() + 1) % 7;
  const dayName = AR_DAYS[now.getDay()];
  const query = String(restaurantQuery || "").trim();

  const [workRows] = await db.query(
    `
    SELECT day_of_week, open_time, close_time, is_closed, notes
    FROM branch_work_times
    WHERE (? IS NULL OR branch_id = ?)
    ORDER BY day_of_week ASC
    `,
    [branchId, branchId]
  );

  const todayBranch = (workRows || []).find(
    (row) => Number(row.day_of_week) === branchDay
  );
  const branchOpen = todayBranch
    ? isOpenAtRange(
        todayBranch.open_time,
        todayBranch.close_time,
        todayBranch.is_closed,
        now
      )
    : true;

  const week = (workRows || []).map((row) => ({
    day: BRANCH_DAYS[Number(row.day_of_week)] || String(row.day_of_week),
    from: formatTime12Ar(row.open_time),
    to: formatTime12Ar(row.close_time),
    closed: Number(row.is_closed) === 1,
  }));

  let restaurantSql = `
    SELECT id, name
    FROM restaurants
    WHERE (? IS NULL OR branch_id = ?)
  `;
  const restaurantParams = [branchId, branchId];
  if (query) {
    restaurantSql += ` AND (name LIKE ? OR COALESCE(name_en, '') LIKE ?) `;
    restaurantParams.push(`%${query}%`, `%${query}%`);
  }
  restaurantSql += ` ORDER BY name ASC LIMIT 20 `;

  const [restaurants] = await db.query(restaurantSql, restaurantParams);
  const restaurantIds = (restaurants || []).map((row) => row.id);
  const scheduleByRestaurant = new Map();

  if (restaurantIds.length) {
    const [schedules] = await db.query(
      `
      SELECT restaurant_id, day, start_time, end_time, closed
      FROM restaurant_schedule
      WHERE restaurant_id IN (?)
      `,
      [restaurantIds]
    );
    for (const item of schedules || []) {
      const list = scheduleByRestaurant.get(item.restaurant_id) || [];
      list.push(item);
      scheduleByRestaurant.set(item.restaurant_id, list);
    }
  }

  const restaurantHours = (restaurants || []).map((row) => {
    const schedule = scheduleByRestaurant.get(row.id) || [];
    const todaySchedule = schedule.find((item) => item.day === dayName);
    let isOpen = true;
    let todayFrom = null;
    let todayTo = null;
    if (todaySchedule && todaySchedule.start_time && todaySchedule.end_time) {
      todayFrom = todaySchedule.start_time;
      todayTo = todaySchedule.end_time;
      isOpen =
        Number(todaySchedule.closed) !== 1 &&
        isOpenAtRange(
          todaySchedule.start_time,
          todaySchedule.end_time,
          todaySchedule.closed,
          now
        );
    }
    return {
      name: row.name,
      is_open: isOpen,
      today_from: formatTime12Ar(todayFrom),
      today_to: formatTime12Ar(todayTo),
      closed_today: todaySchedule ? Number(todaySchedule.closed) === 1 : false,
    };
  });

  const openCount = restaurantHours.filter((item) => item.is_open).length;

  return {
    now: now.toTimeString().slice(0, 5),
    day_name: dayName,
    can_order_now: branchOpen,
    branch: {
      is_open: branchOpen,
      today_from: formatTime12Ar(todayBranch?.open_time),
      today_to: formatTime12Ar(todayBranch?.close_time),
      closed_today: Number(todayBranch?.is_closed) === 1,
      notes: todayBranch?.notes || null,
      week,
    },
    restaurants: restaurantHours,
    open_restaurants: openCount,
    total_restaurants: restaurantHours.length,
    summary: branchOpen
      ? `فرع جو مفتوح الآن (${dayName} من ${formatTime12Ar(todayBranch?.open_time) || "غير محدد"} إلى ${formatTime12Ar(todayBranch?.close_time) || "غير محدد"}). المحلات المفتوحة: ${openCount}.`
      : `فرع جو مغلق الآن (${dayName}). ${
          Number(todayBranch?.is_closed) === 1
            ? "اليوم إجازة."
            : `دوامه من ${formatTime12Ar(todayBranch?.open_time) || "غير محدد"} إلى ${formatTime12Ar(todayBranch?.close_time) || "غير محدد"}.`
        } لا يمكن إنشاء طلب جديد حتى يفتح الفرع.`,
  };
}

export function wantsHuman(text) {
  return /موظف|خدمة العملاء|بشري|إنسان|انسان|ادمن|أدمن|agent|human/i.test(
    String(text || "")
  );
}

export function shouldAiReply(chat) {
  if (chat?.assigned_agent_id) return false;
  const status = String(chat?.status || "");
  if (["AGENT_ACTIVE", "open", "CLOSED", "closed"].includes(status)) return false;
  const handler = String(chat?.handler_mode || "").toUpperCase();
  if (handler === "HUMAN" && chat?.agent_claimed_at) return false;
  return true;
}

export async function insertSupportEvent({
  chatId,
  eventType,
  actorType = null,
  actorId = null,
  actorName = null,
  details = null,
}) {
  await db.query(
    `
    INSERT INTO support_chat_events
      (chat_id, event_type, actor_type, actor_id, actor_name, details)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      chatId,
      eventType,
      actorType,
      actorId,
      actorName,
      details ? JSON.stringify(details) : null,
    ]
  );
}

async function runCustomerTools({ customerId, branchId, name, args }) {
  try {
  if (name === "get_my_orders") {
    const [orders] = await db.query(
      `
      SELECT
        id,
        COALESCE(order_number, id) AS order_number,
        status,
        total_amount,
        delivery_fee,
        extra_store_fee,
        created_at
      FROM orders
      WHERE customer_id = ?
        AND (? IS NULL OR branch_id = ?)
      ORDER BY id DESC
      LIMIT 8
      `,
      [customerId, branchId, branchId]
    );
    return {
      orders: (orders || []).map((row) => ({
        id: row.id,
        order_number: row.order_number,
        status: row.status,
        status_ar: orderStatusAr(row.status),
        total_amount: row.total_amount,
        delivery_fee: row.delivery_fee,
        extra_store_fee: row.extra_store_fee,
        created_at: row.created_at,
      })),
    };
  }

  if (name === "get_order_details") {
    const orderId = Number(args?.order_id);
    if (!orderId) return { error: "رقم الطلب مطلوب" };

    const [[order]] = await db.query(
      `
      SELECT
        id,
        customer_id,
        COALESCE(order_number, id) AS order_number,
        status,
        total_amount,
        delivery_fee,
        extra_store_fee,
        created_at
      FROM orders
      WHERE id = ?
      LIMIT 1
      `,
      [orderId]
    );
    if (!order || Number(order.customer_id) !== Number(customerId)) {
      return { error: "الطلب غير موجود ضمن طلباتك" };
    }

    const [items] = await db.query(
      `
      SELECT
        oi.quantity,
        oi.price,
        COALESCE(p.name, oi.product_name) AS product_name,
        r.name AS restaurant_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN restaurants r ON r.id = oi.restaurant_id
      WHERE oi.order_id = ?
      LIMIT 40
      `,
      [orderId]
    );

    return {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      status_ar: orderStatusAr(order.status),
      total_amount: order.total_amount,
      delivery_fee: order.delivery_fee,
      extra_store_fee: order.extra_store_fee,
      created_at: order.created_at,
      items: items || [],
    };
  }

  if (name === "search_catalog") {
    const query = String(args?.query || "").trim();
    if (query.length < 2) return { error: "اكتب اسم المطعم أو المنتج أوضح" };

    const like = `%${query}%`;
    const [restaurants] = await db.query(
      `
      SELECT id, name, COALESCE(is_open, 1) AS is_open
      FROM restaurants
      WHERE (? IS NULL OR branch_id = ?)
        AND (name LIKE ? OR COALESCE(name_en, '') LIKE ?)
      ORDER BY id DESC
      LIMIT 12
      `,
      [branchId, branchId, like, like]
    );

    const [products] = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.price,
        r.name AS restaurant_name
      FROM products p
      JOIN restaurants r ON r.id = p.restaurant_id
      WHERE (? IS NULL OR r.branch_id = ?)
        AND p.name LIKE ?
      ORDER BY p.id DESC
      LIMIT 15
      `,
      [branchId, branchId, like]
    );

    return { restaurants: restaurants || [], products: products || [] };
  }

  if (name === "get_delivery_info") {
    const [[settings]] = await db.query(
      `
      SELECT method, km_price_single, km_price_multi, extra_store_fee
      FROM branch_delivery_settings
      WHERE branch_id = ?
      LIMIT 1
      `,
      [branchId]
    );
    const [neighborhoods] = await db.query(
      `
      SELECT name, delivery_fee, extra_store_fee
      FROM neighborhoods
      WHERE (? IS NULL OR branch_id = ?)
      ORDER BY name ASC
      LIMIT 40
      `,
      [branchId, branchId]
    );
    return {
      method: settings?.method || null,
      km_price_single: settings?.km_price_single ?? null,
      km_price_multi: settings?.km_price_multi ?? null,
      extra_store_fee: settings?.extra_store_fee ?? null,
      neighborhoods: neighborhoods || [],
    };
  }

  if (name === "get_hours") {
    return getHoursData(branchId, args?.restaurant_name || args?.query || "");
  }

  if (name === "get_app_help") {
    return {
      how_to_order:
        "افتح التطبيق، اختر النوع ثم المحل، أضف المنتجات للسلة، حدد العنوان، واضغط إتمام الطلب. للدفع حسب الطرق المتاحة في الفرع.",
      wassel:
        "خدمة وصل لي لتوصيل طرود بين عنوانين داخل نفس الفرع. حدد موقع الاستلام والتسليم ونوع الطلب ووسيلة النقل ثم اعرض الفاتورة.",
      support:
        "للشكاوى المالية أو مشاكل التوصيل التي تحتاج قرار بشري استخدم تحويل لموظف.",
    };
  }

  return { error: "أداة غير معروفة" };
  } catch (error) {
    console.error("support AI tool error:", name, error?.message || error);
    return { error: "تعذر جلب البيانات حالياً" };
  }
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_my_orders",
      description: "جلب آخر طلبات العميل الحالي فقط",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "تفاصيل طلب يخص العميل الحالي",
      parameters: {
        type: "object",
        properties: { order_id: { type: "number" } },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "بحث مطاعم أو منتجات في فرع العميل",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_delivery_info",
      description: "رسوم التوصيل حسب إعداد الفرع والأحياء",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_hours",
      description:
        "دوام فرع جو الحالي ومحلاته: هل مفتوح الآن، أوقات اليوم، وهل يمكن الطلب. إذا سأل عن محل معين مرر اسمه",
      parameters: {
        type: "object",
        properties: {
          restaurant_name: { type: "string" },
          query: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_help",
      description: "شرح طريقة الطلب ووصل لي",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "handoff_to_human",
      description:
        "حوّل المحادثة لموظف إذا عجزت عن الحل أو طلب العميل موظفاً أو كانت شكوى/مالية/توصيل يحتاج قرار بشري",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
];

function systemPrompt(hoursContext = "") {
  return `أنت مساعد تطبيق جو (GO) للتوصيل في اليمن.
تكلم بالعربية بلهجة يمنية واضحة ومهذبة، وجمل قصيرة.
إذا رحّب العميل (هلو، مرحبا، السلام...) رد بترحيب ودود واسأله كيف تساعده. لا تحوّل الترحيب إلى موظف أبداً.
جاوب عن التطبيق، طريقة الطلب، المحلات، المنتجات، الأسعار، رسوم التوصيل، وطلبات هذا العميل فقط.
استخدم الأدوات لجلب بيانات حقيقية. لا تخترع حالة طلب أو سعر أو وقت دوام.
دوام الفرع الآن: ${hoursContext || "غير متوفر"}.
إذا سأل هل يقدر يطلب الآن، أو هل الدوام شغال، أو هل محل مفتوح/مغلق: استدعِ get_hours. إن ذكر اسم محل مرّره في restaurant_name.
إذا الفرع مغلق قل بوضوح أنه مغلق واذكر وقت الدوام. لا تقل "تقدر تطلب الآن" إذا الفرع مغلق.
لا تنفّذ إلغاء طلب أو عمليات مالية.
استدعِ handoff_to_human فقط إذا طلب العميل موظفاً صراحة، أو كانت شكوى/مشكلة مالية/توصيل تحتاج قرار بشري بعد أن حاولت المساعدة.
لا تحوّل المحادثة بسبب التحية أو سؤال بسيط.
إذا كانت المحادثة بانتظار موظف، استمر بالمساعدة ولا تحوّل مرة أخرى إلا إذا طلب العميل موظفاً صراحة.`;
}

function isHoursQuestion(text) {
  return /دوام|مداوم|مفتوح|مغلق|خل[صص]|اطلب|الحين|الآن|الان|أقدر|اقدر|يشتغل|شغال|وقت/i.test(
    String(text || "")
  );
}

export async function generateSupportAiReply({
  customerId,
  branchId,
  history = [],
  alreadyWaitingForAgent = false,
}) {
  const lastUser = [...history].reverse().find((item) => item.role === "user");
  if (isGreeting(lastUser?.content)) {
    return { handoff: false, text: WELCOME_TEXT };
  }

  let hoursContext = "";
  try {
    const hours = await getHoursData(branchId);
    hoursContext = hours.summary;
  } catch (error) {
    console.error("hours snapshot:", error?.message || error);
  }

  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    if (hoursContext && isHoursQuestion(lastUser?.content)) {
      return { handoff: false, text: hoursContext };
    }
    return {
      handoff: false,
      text: WELCOME_TEXT,
    };
  }

  const messages = [
    { role: "system", content: systemPrompt(hoursContext) },
    ...history.slice(-16).map((item) => ({
      role: item.role,
      content: item.content,
      ...(item.tool_call_id ? { tool_call_id: item.tool_call_id } : {}),
      ...(item.name ? { name: item.name } : {}),
      ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
    })),
  ];

  let handoff = null;

  for (let step = 0; step < 6; step += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI support error:", response.status, errText.slice(0, 400));
      return {
        handoff: false,
        text: WELCOME_TEXT,
      };
    }

    const data = await response.json();
    const choice = data?.choices?.[0]?.message;
    if (!choice) {
      return {
        handoff: false,
        text: WELCOME_TEXT,
      };
    }

    if (choice.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: choice.content || "",
        tool_calls: choice.tool_calls,
      });

      for (const call of choice.tool_calls) {
        const fnName = call.function?.name;
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }

        if (fnName === "handoff_to_human") {
          if (
            isGreeting(lastUser?.content) ||
            (alreadyWaitingForAgent && !wantsHuman(lastUser?.content))
          ) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: fnName,
              content: JSON.stringify({ ok: false, ignored: true }),
            });
            continue;
          }
          handoff = {
            reason: String(args.reason || "يحتاج متابعة موظف").slice(0, 500),
          };
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: fnName,
            content: JSON.stringify({ ok: true }),
          });
          continue;
        }

        const result = await runCustomerTools({
          customerId,
          branchId,
          name: fnName,
          args,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: fnName,
          content: JSON.stringify(result),
        });
      }

      if (handoff) {
        return {
          handoff: true,
          reason: handoff.reason,
          text: HANDOFF_CUSTOMER_TEXT,
        };
      }
      continue;
    }

    const text = String(choice.content || "").trim();
    if (!text) {
      return {
        handoff: false,
        text: WELCOME_TEXT,
      };
    }
    return { handoff: false, text };
  }

  return {
    handoff: false,
    text: WELCOME_TEXT,
  };
}

export { HANDOFF_CUSTOMER_TEXT };
