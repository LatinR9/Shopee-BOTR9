# Shopee Flash Sale Bot (Windows)

โปรแกรมช่วยกดซื้อ **Shopee Flash Sale** แบบมีหน้าต่างภาษาไทย  
ดับเบิลคลิกแล้วใช้ได้ — ไม่ต้องเปิด Terminal หรือแก้ไฟล์ `.env`

> **ข้อจำกัด:** Shopee มี CAPTCHA / OTP / ระบบกันบอท และกฎการใช้งาน  
> โปรแกรมนี้ช่วยเปิดหน้ารสินค้าและกดซื้อให้เร็วขึ้นเท่านั้น  
> ไม่รับประกันว่าจะซื้อได้เสมอ — ใช้ด้วยความรับผิดชอบของคุณเอง

---

## สำหรับผู้ใช้ทั่วไป (Windows)

### 1) ดาวน์โหลด

ไปที่หน้า **Releases** ของโปรเจกต์นี้:

**https://github.com/LatinR9/Shopee-BOTR9/releases**

เลือกไฟล์อย่างใดอย่างหนึ่ง:

| ไฟล์ | วิธีใช้ |
|------|---------|
| `ShopeeFlashSaleBot-*-portable.exe` | **แนะนำ** — ดับเบิลคลิกเปิดได้เลย ไม่ต้องติดตั้ง |
| `ShopeeFlashSaleBot-*-win-x64.exe` | ตัวติดตั้ง (สร้างไอคอนบนเดสก์ท็อป) |

ถ้ายังไม่มี Release ให้ดูแท็บ **Actions → Build Windows Release** แล้วดาวน์โหลด Artifact `windows-builds`  
หรือรอผู้ดูแลสร้างแท็ก `v1.1.0` เพื่อเผยแพร่

### 2) เปิดโปรแกรม

1. ดับเบิลคลิกไฟล์ `.exe`
2. ถ้า Windows ขึ้นคำเตือน SmartScreen กด **More info → Run anyway** (เพราะยังไม่ได้ซื้อรหัสเซ็นชื่อ)
3. หน้าต่างโปรแกรมจะเปิดขึ้น

### 3) ใช้งาน

1. กด **เข้าสู่ระบบ** → ล็อกอิน Shopee ในเบราว์เซอร์ที่เปิดขึ้น (ทำ CAPTCHA/OTP เองได้)
2. วาง **ลิงก์สินค้า** และตั้ง **เวลาเริ่ม Flash Sale**
3. (ถ้าต้องการ) กด **ทดสอบ** เพื่อเปิดหน้าสินค้าโดยไม่กดซื้อ
4. กด **เริ่มกด Flash Sale**
5. กด **หยุด** ได้ทุกเมื่อ

ค่าที่กรอกจะถูก**บันทึกในเครื่องคุณอัตโนมัติ** ไม่ต้องแก้ไฟล์คอนฟิก

---

## สำหรับนักพัฒนา

```bash
npm install
npm run app          # เปิด GUI
npm run pack:win     # สร้าง .exe (บน Windows หรือใน GitHub Actions)
```

CLI เดิมยังใช้ได้ (`npm start`, `.env.example`) แต่ผู้ใช้ทั่วไปไม่จำเป็นต้องใช้

โครงสร้างหลัก:

```
electron/           # หน้าต่าง GUI (ไทย)
src/                # ตรรกะ Playwright / Flash Sale
scripts/prepare-browsers.cjs
.github/workflows/release-windows.yml
```

Chromium ของ Playwright ถูกบรรจุไปกับตัวติดตั้งแล้ว ไม่ต้องลงแยก

---

## สร้างไฟล์ดาวน์โหลด (Release)

บน GitHub:

1. สร้างแท็ก เช่น `v1.1.0` แล้ว push  
   หรือรัน workflow **Build Windows Release** แบบ manual
2. เมื่อบิลด์เสร็จ ไฟล์ `.exe` จะถูกแนบใน Release / Artifacts

---

## License

MIT
