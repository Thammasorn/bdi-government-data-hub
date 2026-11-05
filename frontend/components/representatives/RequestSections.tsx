"use client";

import { Rows } from "@/components/organization/DetailView";
import { Card, CardHeader } from "@/components/ui/Card";
import { api } from "@/lib/api";
import type { ChangeDetail } from "@/lib/representatives";
import { fullName, phoneWithExtension } from "@/lib/types";

/** สามส่วนของคำขอแบบอ่านอย่างเดียว — หน้ารายละเอียดกับหน้าตรวจสอบก่อนนำส่งเห็นเหมือนกัน */
export function ChangeRequestSections({ request }: { request: ChangeDetail }) {
  return (
    <>
      <Card>
        <CardHeader tag="ส่วนที่ 1" title="ยกเลิกรายชื่อผู้แทนเดิม" />
        {request.removals.length ? (
          <ul className="divide-y divide-line">
            {request.removals.map((r) => (
              <li key={r.id} className="px-6 py-3.5">
                <p className="text-[15px] text-ink">
                  {r.name}
                  {r.pendingInvitee ? " (รอเปิดใช้งาน)" : ""}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {[r.roleLabel, r.positionTh, r.departmentTh].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-6 py-5 text-sm text-ink-muted">ไม่มี</p>
        )}
      </Card>

      <Card>
        <CardHeader tag="ส่วนที่ 2" title="เพิ่มรายชื่อผู้แทนใหม่" />
        {request.additions.length ? (
          <div className="divide-y divide-line">
            {request.additions.map((a, index) => {
              const check = request.review?.accountChecks.find((c) => c.additionId === a.id);
              return (
                <div key={a.id}>
                  <p className="px-6 pt-4 text-sm font-semibold text-navy-800">
                    ผู้แทนลำดับที่ {index + 1} · {a.roleLabel}
                  </p>
                  {check ? (
                    <p className={check.ok ? "px-6 pt-1 text-[13px] text-success" : "px-6 pt-1 text-[13px] text-danger"}>
                      {check.ok ? "ตรวจบัญชีผ่าน: " : "ตรวจบัญชีไม่ผ่าน: "}
                      {check.message}
                    </p>
                  ) : null}
                  <Rows
                    rows={[
                      ["ชื่อ-นามสกุล", fullName(a.prefixTh, a.firstnameTh, a.lastnameTh)],
                      ["เลขประจำตัวประชาชน", a.cid],
                      ["ตำแหน่ง", a.positionTh],
                      ["ฝ่าย/กอง/สำนัก", a.departmentTh],
                      ["อีเมล", a.email],
                      ["เบอร์โทรศัพท์", phoneWithExtension(a.phoneNumber, a.phoneNumberExtension)],
                    ]}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-6 py-5 text-sm text-ink-muted">ไม่มี</p>
        )}
      </Card>

      <Card>
        <CardHeader tag="ส่วนที่ 3" title="เอกสารแนบ" />
        {request.attachment ? (
          <div className="flex items-center gap-3 px-6 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">หนังสือนำและฟอร์มแจ้งรายละเอียด</p>
              <p className="truncate text-[13px] text-ink-muted">{request.attachment.filename}</p>
            </div>
            <a
              href={api.fileUrl(`/api/representative-changes/${request.id}/attachments/${request.attachment.id}`)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-navy-800 transition-colors hover:bg-navy-50"
            >
              เปิดดู
            </a>
          </div>
        ) : (
          <p className="px-6 py-5 text-sm text-ink-muted">ยังไม่มีไฟล์แนบ</p>
        )}
      </Card>
    </>
  );
}
