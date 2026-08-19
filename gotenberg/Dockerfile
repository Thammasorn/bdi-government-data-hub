# ตัวแปลง .docx -> PDF ของระบบ — LibreOffice ที่ห่อด้วย HTTP API
#
# ทำไมต้องเป็นบริการแยก: เอกสารกฎหมาย A0–A3 เป็น template .docx ที่ผู้ใช้แก้เองได้
# เลย์เอาต์จึงต้องมาจาก LibreOffice ที่จัดหน้าจากไฟล์ต้นฉบับ ไม่ใช่จากโค้ดวาดทับ
# เรียก soffice ตรง ๆ จาก backend ได้ แต่ต้องจัดการ user profile ที่ชนกันเมื่อมีหลาย
# request พร้อมกัน กับ process ที่ค้าง — gotenberg ทำสองอย่างนั้นให้อยู่แล้ว
#
# variant `-libreoffice` ตัด Chromium ออก (เล็กกว่า image เต็มราว 38%) ระบบนี้ไม่ได้
# แปลง HTML เป็น PDF จึงไม่ต้องใช้
FROM gotenberg/gotenberg:8-libreoffice

# **ฟอนต์ต้องอยู่ใน image นี้** ไม่ใช่แค่ในไฟล์ .docx
#
# LibreOffice คำนวณการตัดบรรทัดและการแบ่งหน้าจากฟอนต์ที่ติดตั้งอยู่ในเครื่อง ถ้าไม่มี
# TH SarabunPSK มันจะแทนด้วยฟอนต์อื่นแล้วเลย์เอาต์เลื่อนทั้งฉบับ — เป็นอาการที่ดู
# เหมือน template พัง ทั้งที่ template ถูก template สั่ง TH SarabunPSK 16pt ตามที่
# สเปกกำหนด (assets/document-template/THSarabunPSKv1.0.zip เป็นที่มาของไฟล์เหล่านี้)
USER root
COPY fonts/*.ttf /usr/local/share/fonts/thsarabunpsk/
RUN chmod 644 /usr/local/share/fonts/thsarabunpsk/*.ttf && fc-cache -f \
    && fc-list | grep -q "TH SarabunPSK" \
    || (echo "TH SarabunPSK ไม่ได้ถูกติดตั้ง — เลย์เอาต์ของเอกสารจะเพี้ยน" && exit 1)
USER gotenberg
