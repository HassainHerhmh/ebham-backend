import db from "../db.js";

const HANDOFF_CUSTOMER_TEXT =
  "أعتذر منك، يبدو أن مشكلتك تحتاج متابعة من فريق خدمة العملاء. حولت محادثتك إلى أحد الموظفين، وسيتم الرد عليك قريباً.";

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

export function shouldAiReply(chat) {
  const status = String(chat?.status || "");
  if (chat?.assigned_agent_id) return false;
  return status === "AI_ACTIVE" || status === "RESOLVED";
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

function systemPrompt() {
  return `أنت مساعد تطبيق جو (GO) للتوصيل في اليمن.
تكلم بالعربية بلهجة يمنية واضحة ومهذبة، وجمل قصيرة.
جاوب عن التطبيق، طريقة الطلب، المحلات، المنتجات، الأسعار، رسوم التوصيل، وطلبات هذا العميل فقط.
استخدم الأدوات لجلب بيانات حقيقية. لا تخترع حالة طلب أو سعر.
لا تنفّذ إلغاء طلب أو عمليات مالية.
إذا طلب العميل موظفاً، أو الشكوى تحتاج تدخل بشري، أو البيانات ناقصة/فشلت الأداة، أو لم تفهم بعد توضيح، استدعِ handoff_to_human مع سبب مختصر.
لا تدّعِ أن المشكلة انحلت إن لم تُحل فعلياً.`;
}

export async function generateSupportAiReply({
  customerId,
  branchId,
  history = [],
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      handoff: true,
      reason: "مفتاح الذكاء الاصطناعي غير مُعد",
      text: HANDOFF_CUSTOMER_TEXT,
    };
  }

  const messages = [
    { role: "system", content: systemPrompt() },
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
        handoff: true,
        reason: "تعذر الاتصال بخدمة الذكاء الاصطناعي",
        text: HANDOFF_CUSTOMER_TEXT,
      };
    }

    const data = await response.json();
    const choice = data?.choices?.[0]?.message;
    if (!choice) {
      return {
        handoff: true,
        reason: "رد الذكاء الاصطناعي فارغ",
        text: HANDOFF_CUSTOMER_TEXT,
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
        handoff: true,
        reason: "لم يتم توليد رد مفهوم",
        text: HANDOFF_CUSTOMER_TEXT,
      };
    }
    return { handoff: false, text };
  }

  return {
    handoff: true,
    reason: "تجاوز الذكاء عدد محاولات الأداة",
    text: HANDOFF_CUSTOMER_TEXT,
  };
}

export { HANDOFF_CUSTOMER_TEXT };
