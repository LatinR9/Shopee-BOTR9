# Shopee Flash Sale Bot (Windows)

โปรแกรมช่วยกดซื้อ **Shopee Flash Sale** แบบมีหน้าต่างภาษาไทย  
ดับเบิลคลิกแล้วใช้ได้ — ไม่ต้องเปิด Terminal หรือแก้ไฟล์ `.env`

> **ข้อจำกัด:** Shopee มี CAPTCHA / OTP / ระบบกันบอท และกฎการใช้งาน  
> โปรแกรมนี้ช่วยเปิดหน้ารสินค้าและกดซื้อให้เร็วขึ้นเท่านั้น  
> ไม่รับประกันว่าจะซื้อได้เสมอ — ใช้ด้วยความรับผิดชอบของคุณเอง

---

## สำหรับผู้ใช้ทั่วไป (Windows)

### 1) ดาวน์โหลด

ไปที่หน้า **Releases**:

**https://github.com/LatinR9/Shopee-BOTR9/releases**

| ไฟล์ | วิธีใช้ |
|------|---------|
| `ShopeeFlashSaleBot-Setup-*.exe` | **แนะนำ** — ตัวติดตั้ง (รองรับอัปเดตอัตโนมัติในเครื่อง) |
| `ShopeeFlashSaleBot-*-portable.exe` | ไฟล์พกพา ดับเบิลคลิกได้เลย แต่**อัปเดตเองไม่ได้** ต้องดาวน์โหลดใหม่ |

ถ้า Windows ขึ้นคำเตือน SmartScreen กด **More info → Run anyway**  
(โปรแกรมยัง**ไม่ได้เซ็นชื่อดิจิทัล / code signing**)

### 2) อัปเดตอัตโนมัติ (ตัวติดตั้งเท่านั้น)

- เมื่อเปิดโปรแกรม ระบบจะตรวจเวอร์ชันใหม่จาก GitHub Releases
- ถ้ามีอัปเดต จะมีแถบแจ้งเตือนภาษาไทย → กดดาวน์โหลด → รีสตาร์ทเพื่อติดตั้ง
- **เวอร์ชัน portable อัปเดตเองไม่ได้** — ใช้ตัว Setup หรือดาวน์โหลดไฟล์ใหม่จาก Releases
- เพราะยังไม่เซ็นชื่อดิจิทัล Windows อาจเตือน SmartScreen ทุกครั้งที่อัปเดต/ติดตั้ง

### 3) ใช้งาน

1. กด **เข้าสู่ระบบ** → ล็อกอิน Shopee ในเบราว์เซอร์ (CAPTCHA/OTP ทำมือได้)
2. วาง **ลิงก์สินค้า** และตั้ง **เวลาเริ่ม Flash Sale**
3. (ถ้าต้องการ) กด **ทดสอบ**
4. กด **เริ่มกด Flash Sale** / **หยุด** ได้ทุกเมื่อ

ค่าที่กรอกถูกบันทึกในเครื่องคุณอัตโนมัติ

---

## สำหรับนักพัฒนา

```bash
npm install
npm run app          # เปิด GUI
npm run pack:win     # สร้าง Setup + portable (+ latest.yml / blockmap)
```

โครงสร้างหลัก:

```
electron/           # GUI + auto-updater
src/                # Playwright / Flash Sale
.github/workflows/release-windows.yml
```

Release ต้องแนบ `*.exe`, `*.blockmap`, และ `latest.yml` เพื่อให้ electron-updater ทำงาน

---

## License

MIT
