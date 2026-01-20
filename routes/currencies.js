import React, { useEffect, useState } from "react";
import api from "../../services/api";

type Currency = {
  id: number;
  name_ar: string;
  code: string;
  exchange_rate: number;
  min_rate?: number | null;
  max_rate?: number | null;
  is_local: number;
};

type Account = {
  id: number;
  name_ar: string;
};

const today = new Date().toLocaleDateString("en-CA");

const CurrencyExchange: React.FC = () => {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [fromCurrency, setFromCurrency] = useState<Currency | null>(null);
  const [toCurrency, setToCurrency] = useState<Currency | null>(null);

  const [rate, setRate] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState(0);

  const [fromAccount, setFromAccount] = useState("");
  const [toAccount, setToAccount] = useState("");
  const [date, setDate] = useState(today);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [cRes, aRes] = await Promise.all([
      api.get("/currencies"),
      api.get("/accounts"),
    ]);

    setCurrencies(cRes.data.currencies || []);
    setAccounts(aRes.data.list || []);
  };

  useEffect(() => {
    if (!fromCurrency || !toCurrency) return;

    const a = Number(amount);
    const r = Number(rate);

    if (!a || !r) {
      setResult(0);
      return;
    }

    // المحلي = ضرب، غير المحلي = قسمة
    const value =
      fromCurrency.is_local === 1 ? a * r : a / r;

    setResult(Number(value.toFixed(2)));
  }, [amount, rate, fromCurrency, toCurrency]);

  const onSelectFrom = (id: string) => {
    const cur = currencies.find((c) => c.id === Number(id)) || null;
    setFromCurrency(cur);

    if (!cur) return;

    setRate(String(cur.exchange_rate));
  };

  const onRateChange = (val: string) => {
    if (!fromCurrency) return;

    const num = Number(val);

    if (
      (fromCurrency.min_rate && num < fromCurrency.min_rate) ||
      (fromCurrency.max_rate && num > fromCurrency.max_rate)
    ) {
      return; // خارج المدى المسموح
    }

    setRate(val);
  };

  const submit = async () => {
    if (!fromCurrency || !toCurrency || !amount || !rate) {
      alert("يرجى إدخال جميع البيانات");
      return;
    }

    alert("جاهز للربط مع السيرفر");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">مصارفة عملة</h2>

      <div className="bg-[#e9efe6] p-4 rounded-lg grid grid-cols-3 gap-4">
        <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />

        <select className="input" onChange={(e) => onSelectFrom(e.target.value)}>
          <option value="">-- العملة المصدر --</option>
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>{c.name_ar}</option>
          ))}
        </select>

        <select className="input" onChange={(e) => setToCurrency(
          currencies.find(c => c.id === Number(e.target.value)) || null
        )}>
          <option value="">-- العملة المقابلة --</option>
          {currencies.map((c) => (
            <option key={c.id} value={c.id}>{c.name_ar}</option>
          ))}
        </select>

        <input className="input" placeholder="المبلغ" value={amount} onChange={(e) => setAmount(e.target.value)} />

        <input
          className="input"
          placeholder="سعر الصرف"
          value={rate}
          onChange={(e) => onRateChange(e.target.value)}
          disabled={!!(fromCurrency && !fromCurrency.min_rate && !fromCurrency.max_rate)}
        />

        <input className="input bg-gray-100" disabled value={result || ""} placeholder="الناتج" />

        <div className="col-span-3 text-sm text-gray-600">
          المعامل: {fromCurrency?.is_local === 1 ? "ضرب" : "قسمة"}
        </div>

        <select className="input" value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}>
          <option value="">-- من حساب --</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name_ar}</option>
          ))}
        </select>

        <select className="input" value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
          <option value="">-- إلى حساب --</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name_ar}</option>
          ))}
        </select>

        <div className="col-span-3 flex justify-end">
          <button onClick={submit} className="btn-green">تنفيذ المصارفة</button>
        </div>
      </div>

      <style>{`
        .input { padding:10px; border-radius:8px; border:1px solid #ccc; }
        .btn-green { background:#14532d; color:#fff; padding:10px 20px; border-radius:8px; }
      `}</style>
    </div>
  );
};

export default CurrencyExchange;
