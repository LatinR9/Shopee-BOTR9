# Shopee-BOTR9 — Flash Sale Click Bot

บอทกด Flash Sale ของ Shopee ด้วย Playwright  
Shopee Flash Sale auto-click / checkout helper (Playwright).

> **ข้อจำกัด / Limitations:** Shopee มี CAPTCHA, OTP, anti-bot และกฎการใช้งาน  
> บอทนี้ช่วยเปิดหน้ารสินค้า → กดซื้อ/เช็คเอาต์ให้เร็วขึ้นเท่านั้น  
> ไม่รับประกันว่าจะซื้อได้เสมอ และอาจผิด Terms of Service — ใช้ด้วยความรับผิดชอบของคุณเอง

---

## สิ่งที่ทำได้ / What it does

1. เปิดลิงก์สินค้าที่ตั้งไว้  
2. รอถึงเวลา Flash Sale (`SHOPEE_SALE_START`)  
3. กด **ซื้อสินค้า / Buy Now** ซ้ำๆ ทันทีที่ปุ่มพร้อม  
4. พยายามไปหน้า Checkout  
5. (ถ้าเปิด) กด Place Order — ค่าเริ่มต้นคือ **ปิด** เพื่อให้คุณยืนยันเอง

รหัสผ่าน / cookie / token **ไม่ถูก hardcode** — ใส่ใน `.env` เท่านั้น (ไฟล์นี้ถูก gitignore)

---

## ติดตั้ง / Setup

ต้องมี **Node.js 18+**

```bash
git clone https://github.com/LatinR9/Shopee-BOTR9.git
cd Shopee-BOTR9
npm install
cp .env.example .env
```

แก้ `.env`:

| ตัวแปร | ความหมาย |
|--------|----------|
| `SHOPEE_PRODUCT_URL` | ลิงก์สินค้าเต็ม (จำเป็น) |
| `SHOPEE_SALE_START` | เวลาเริ่มขาย เช่น `2026-11-10T12:00:00+07:00` |
| `SHOPEE_PRECLICK_MS` | เริ่มกดก่อนกี่ ms (ค่าเริ่มต้น 500) |
| `SHOPEE_QUANTITY` | จำนวน |
| `SHOPEE_VARIANTS` | ตัวเลือกสินค้า คั่นด้วยจุลภาค เช่น `สีดำ,XL` |
| `SHOPEE_USERNAME` / `SHOPEE_PASSWORD` | สำหรับ `npm run login` เท่านั้น |
| `SHOPEE_HEADLESS` | `false` = เห็นเบราว์เซอร์ (แนะนำครั้งแรก) |
| `SHOPEE_AUTO_PLACE_ORDER` | `true` = กดสั่งซื้ออัตโนมัติ (ระวัง) |
| `SHOPEE_USER_DATA_DIR` | โฟลเดอร์เซฟ session (ค่าเริ่มต้น `.auth/user-data`) |

---

## ล็อกอินครั้งแรก / First login

รันแบบเห็นหน้าจอ แล้วล็อกอิน (CAPTCHA/OTP ทำมือได้):

```bash
npm run login
```

เซสชันจะถูกเก็บใน `.auth/` (ไม่ commit)

หรือใส่ `SHOPEE_USERNAME` + `SHOPEE_PASSWORD` ใน `.env` แล้วให้สคริปต์พยายามกรอกให้อัตโนมัติ

---

## รันบอท / Run

ทดสอบเปิดหน้าสินค้าอย่างเดียว:

```bash
npm run dry-run
```

รันจริง:

```bash
npm start
```

เปิดเบราว์เซอร์บังคับ:

```bash
node src/index.js --headed
```

สกรีนช็อตจะอยู่ที่โฟลเดอร์ `screenshots/`

---

## โครงสร้าง / Layout

```
src/
  index.js      # entry
  bot.js        # รอเวลา + กด Buy Now / checkout
  login.js      # บันทึก session
  config.js     # อ่าน .env
  selectors.js  # CSS / text selectors (อัปเดตได้เมื่อ UI เปลี่ยน)
  browser.js    # Playwright persistent profile
.env.example    # ตัวอย่างคอนฟิก (ไม่มี secret)
```

---

## ข้อควรรู้ / Notes

- DOM ของ Shopee เปลี่ยนบ่อย — ถ้าปุ่มไม่ถูกกด ให้แก้รายการใน `src/selectors.js`
- สต็อกหมดเร็ว / คิว / CAPTCHA / หน้า `/verify/traffic` (anti-bot) อาจทำให้พลาดได้  
  ถ้าเจอหน้าตรวจจับบอท ให้รันแบบเห็นหน้าจอ (`SHOPEE_HEADLESS=false`) แล้ว `npm run login` ให้ผ่าน CAPTCHA ก่อน
- อย่า commit ไฟล์ `.env`, `.auth/`, `cookies.json`
- ใช้กับบัญชีตัวเองและยอมรับความเสี่ยงด้านบัญชีถูกจำกัด

---

## License

MIT
