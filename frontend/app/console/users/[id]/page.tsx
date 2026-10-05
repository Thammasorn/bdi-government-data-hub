"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useSession } from "@/components/SessionProvider";
import { ActionDialog } from "@/components/console/ActionDialog";
import { OrganizationPicker } from "@/components/console/OrganizationPicker";
import {
  Badge,
  DetailList,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Panel,
  Tabs,
  Tag,
  WarningList,
} from "@/components/console/ui";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";
import {
  AUDIT_ACTION_LABELS,
  BDI_ROLE_CODES,
  INVITATION_STATUS_META,
  ORGANIZATION_ROLES,
  USER_STATUS_META,
  invitationState,
  type AdminRoleAssignment,
  type AdminUser,
  type AdminUserDetail,
} from "@/lib/admin";
import { adminErrorView } from "@/lib/admin-errors";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatThaiDate, type Role } from "@/lib/status";
import { phoneWithExtension } from "@/lib/types";
import { accountName, useAdminData } from "@/lib/use-admin";

type TabKey = "profile" | "roles" | "access" | "history";

/** คำสั่งที่เปิดกล่องยืนยันอยู่ — หนึ่งกล่องต่อหนึ่งหน้า */
type Dialog =
  | "suspend"
  | "reinstate"
  | "deactivate"
  | "reactivate"
  | "release"
  | "password"
  | "sessions"
  | "identity"
  | "grant"
  | "transfer"
  | { revoke: AdminRoleAssignment }
  | null;

/**
 * บัญชีหนึ่งบัญชี — ทุกคำสั่งของ /api/admin/users/:id อยู่ที่หน้านี้
 *
 * ปุ่มที่แสดงขึ้นกับสถานะของบัญชี (ระงับได้เฉพาะบัญชีที่ใช้งานอยู่ ฯลฯ) ตามกติกาเดียวกับ API ปุ่มที่ทำไม่ได้จึงไม่แสดงเลย
 * แทนที่จะกดแล้วได้ 409 ส่วนกติกาที่ต้องถามฐานข้อมูล (ผู้ถือคนสุดท้าย ที่นั่งมีคนนั่ง) ยังตัดสินที่ API และกล่องยืนยันแสดง
 * คำตอบพร้อมลิงก์ไปสิ่งที่ขวางอยู่
 */
export default function ConsoleUserPage() {
  const { id } = useParams<{ id: string }>();
  const { user: me } = useSession();
  const { show } = useToast();
  const { data, error, loading, reload } = useAdminData<AdminUserDetail>(`/api/admin/users/${id}`);
  const [tab, setTab] = useState<TabKey>("profile");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (loading && !data) return <Spinner />;
  if (error && !data) {
    return (
      <div>
        <PageHeader title="ไม่พบบัญชี" back={{ href: "/console/users", label: "ผู้ใช้ทั้งหมด" }} />
        <ErrorNotice view={adminErrorView(error)} />
      </div>
    );
  }
  if (!data) return null;

  const u = data.user;
  const isSelf = me?.id === u.id;
  const activeRoles = data.roleAssignments.filter((a) => a.derivedStatus === "ACTIVE");
  const close = () => setDialog(null);
  const done = (title: string, detail?: string) => {
    show({ tone: "success", title, detail });
    reload();
  };
  const post = (path: string, body?: unknown) => api.post<Record<string, unknown>>(`/api/admin/users/${u.id}${path}`, body);

  return (
    <div>
      <PageHeader
        back={{ href: "/console/users", label: "ผู้ใช้ทั้งหมด" }}
        eyebrow={u.accountType === "BDI" ? "บัญชีฝั่ง BDI" : "บัญชีฝั่งหน่วยงาน"}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {accountName(u)}
            <Badge meta={USER_STATUS_META[u.status]} />
            {isSelf ? <Tag>บัญชีของคุณ</Tag> : null}
          </span>
        }
        description={u.email}
        actions={<StatusActions user={u} isSelf={isSelf} open={setDialog} />}
      />

      <StatusBanner user={u} />
      <WarningList warnings={warnings} className="mb-5" />

      <Tabs
        tabs={[
          { key: "profile", label: "ข้อมูลบัญชี" },
          { key: "roles", label: "บทบาทและหน่วยงาน", count: activeRoles.length },
          { key: "access", label: "การเข้าใช้งาน", count: data.sessions.length },
          { key: "history", label: "ประวัติ" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5 space-y-5">
        {tab === "profile" ? (
          <>
            <ProfilePanel user={u} onSaved={() => done("บันทึกข้อมูลบัญชีแล้ว")} />
            <Panel
              title="ตัวตนสำหรับเข้าระบบ"
              description="อีเมลใช้เข้าสู่ระบบ เลขบัตรประชาชนใช้เทียบกับ ThaID ตอนเปิดใช้งาน — เปลี่ยนแล้วเจ้าของบัญชีถูกออกจากระบบทุกอุปกรณ์"
              actions={
                !isSelf && u.status !== "DEACTIVATED" ? (
                  <Button size="sm" variant="secondary" onClick={() => setDialog("identity")}>
                    เปลี่ยนอีเมลหรือเลขบัตร
                  </Button>
                ) : null
              }
            >
              <DetailList
                items={[
                  { label: "อีเมล", value: u.email },
                  { label: "เลขประจำตัวประชาชน", value: u.cid },
                  { label: "สร้างบัญชีเมื่อ", value: formatThaiDate(u.createdAt) },
                  { label: "เปิดใช้งานเมื่อ", value: u.activatedAt ? formatThaiDate(u.activatedAt) : null },
                ]}
              />
            </Panel>
          </>
        ) : null}

        {tab === "roles" ? (
          <RolesPanel
            detail={data}
            isSelf={isSelf}
            onGrant={() => setDialog("grant")}
            onTransfer={() => setDialog("transfer")}
            onRevoke={(a) => setDialog({ revoke: a })}
          />
        ) : null}

        {tab === "access" ? (
          <>
            <Panel
              title="อุปกรณ์ที่เข้าระบบอยู่"
              description="session ที่ยังไม่หมดอายุ — ปิดทั้งหมดเมื่อสงสัยว่าบัญชีถูกใช้โดยคนอื่น"
              actions={
                data.sessions.length > 0 && !isSelf ? (
                  <Button size="sm" variant="secondary" onClick={() => setDialog("sessions")}>
                    ออกจากระบบทุกอุปกรณ์
                  </Button>
                ) : null
              }
              flush
            >
              {data.sessions.length === 0 ? (
                <EmptyState title="ไม่มีอุปกรณ์ที่เข้าระบบอยู่" />
              ) : (
                <ul className="divide-y divide-line">
                  {data.sessions.map((s) => (
                    <li key={s.id} className="px-5 py-3 text-[14px]">
                      <p className="truncate text-ink">{s.userAgent ?? "ไม่ทราบเบราว์เซอร์"}</p>
                      <p className="text-[13px] text-ink-muted">
                        เข้าระบบ {formatThaiDate(s.createdAt)} · ใช้งานล่าสุด {formatThaiDate(s.lastSeenAt)} · IP{" "}
                        {s.ipAddress ?? "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel
              title="คำเชิญของบัญชีนี้"
              actions={
                <Link
                  href={`/console/invitations?email=${encodeURIComponent(u.email)}`}
                  className="text-[13.5px] font-medium text-navy-700 hover:underline"
                >
                  จัดการคำเชิญ →
                </Link>
              }
              flush
            >
              {data.activationKeys.length === 0 ? (
                <EmptyState title="บัญชีนี้ไม่มีคำเชิญ" />
              ) : (
                <ul className="divide-y divide-line">
                  {data.activationKeys.map((k) => (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px]">
                      <span className="text-ink-muted">
                        ส่งเมื่อ {formatThaiDate(k.issuedAt)} · หมดอายุ {formatThaiDate(k.expiresAt)}
                        {k.usedAt ? ` · ใช้เมื่อ ${formatThaiDate(k.usedAt)}` : ""}
                      </span>
                      <Badge meta={INVITATION_STATUS_META[invitationState(k)]} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        ) : null}

        {tab === "history" ? (
          <Panel
            title="ประวัติของบัญชี"
            description="20 รายการล่าสุดที่เกี่ยวกับบัญชีนี้ — การเปลี่ยนบทบาทอยู่ในแท็บบทบาทและหน่วยงาน"
            flush
          >
            {data.recentAudit.length === 0 ? (
              <EmptyState title="ยังไม่มีประวัติ" />
            ) : (
              <ul className="divide-y divide-line">
                {data.recentAudit.map((a) => {
                  const reason = typeof a.metadataJson?.reason === "string" ? a.metadataJson.reason : null;
                  const actor = typeof a.metadataJson?.actor_name === "string" ? a.metadataJson.actor_name : null;
                  return (
                    <li key={a.id} className="px-5 py-3 text-[14px]">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</span>
                        <span className="text-[13px] text-ink-muted">{formatThaiDate(a.occurredAt)}</span>
                      </div>
                      {actor || reason ? (
                        <p className="text-[13px] text-ink-muted">
                          {actor ? `โดย ${actor}` : null}
                          {actor && reason ? " · " : null}
                          {reason ? `เหตุผล: ${reason}` : null}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>

      {/* ---------------------------------------------------------------- กล่องยืนยัน */}

      <ActionDialog
        open={dialog === "suspend"}
        onClose={close}
        title="ระงับบัญชีชั่วคราว"
        description="เจ้าของบัญชีถูกออกจากระบบทันทีและเข้าใหม่ไม่ได้จนกว่าจะยกเลิกการระงับ — บทบาทยังอยู่ครบ"
        confirmLabel="ระงับบัญชี"
        tone="danger"
        reasonHint="เจ้าของบัญชีเห็นเหตุผลนี้"
        onConfirm={async (reason) => {
          await post("/suspend", { reason });
          done("ระงับบัญชีแล้ว");
        }}
      />
      <ActionDialog
        open={dialog === "reinstate"}
        onClose={close}
        title="ยกเลิกการระงับ"
        description="บัญชีกลับมาเข้าระบบได้ด้วยรหัสผ่านเดิม พร้อมบทบาทเดิม"
        confirmLabel="ยกเลิกการระงับ"
        reason={false}
        onConfirm={async () => {
          await post("/reinstate");
          done("บัญชีกลับมาใช้งานได้แล้ว");
        }}
      />
      <ActionDialog
        open={dialog === "deactivate"}
        onClose={close}
        title="ยุติการใช้งานบัญชี"
        description="ถอนทุกบทบาท ปิดทุก session และยกเลิกคำเชิญที่ยังใช้ได้ บัญชียังอยู่ในระบบเพื่อให้ประวัติอ่านย้อนได้ — เปิดใช้อีกครั้งได้ แต่บทบาทไม่กลับมาเอง"
        confirmLabel="ยุติการใช้งาน"
        tone="danger"
        confirmPhrase={u.email}
        onConfirm={async (reason) => {
          await post("/deactivate", { reason });
          done("ยุติการใช้งานบัญชีแล้ว");
        }}
      />
      <ActionDialog
        open={dialog === "reactivate"}
        onClose={close}
        title="เปิดใช้บัญชีอีกครั้ง"
        description="บัญชีเข้าระบบได้อีกครั้ง แต่ยังไม่มีบทบาท — มอบบทบาทต่อที่แท็บบทบาทและหน่วยงาน"
        confirmLabel="เปิดใช้บัญชี"
        onConfirm={async (reason) => {
          await post("/reactivate", { reason });
          done("เปิดใช้บัญชีแล้ว", "มอบบทบาทให้บัญชีนี้ต่อที่แท็บบทบาทและหน่วยงาน");
        }}
      />
      <ActionDialog
        open={dialog === "release"}
        onClose={close}
        title="ปล่อยอีเมลให้ใช้ใหม่"
        description={`อีเมล ${u.email} ถูกแทนด้วยที่อยู่ภายในระบบ เพื่อให้เชิญคนใหม่ด้วยอีเมลนี้ได้ เลขบัตรยังผูกกับบัญชีเดิม และบัญชีนี้เปิดใช้อีกไม่ได้`}
        confirmLabel="ปล่อยอีเมล"
        tone="danger"
        confirmPhrase={u.email}
        onConfirm={async (reason) => {
          await post("/release-identity", { releaseEmail: true, reason });
          done("ปล่อยอีเมลแล้ว");
        }}
      />
      <ActionDialog
        open={dialog === "password"}
        onClose={close}
        title="ส่งลิงก์ตั้งรหัสผ่านใหม่"
        description={`ส่งอีเมลไปที่ ${u.email} พร้อมลิงก์ตั้งรหัสผ่านใหม่ ใช้ได้ 60 นาทีและใช้ได้ครั้งเดียว — ผู้ดูแลระบบไม่เห็นและไม่ได้ตั้งรหัสผ่านให้`}
        confirmLabel="ส่งลิงก์"
        reason={false}
        onConfirm={async () => {
          await api.post("/api/admin/users/password-reset", { email: u.email });
          done("ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว", u.email);
        }}
      />
      <ActionDialog
        open={dialog === "sessions"}
        onClose={close}
        title="ออกจากระบบทุกอุปกรณ์"
        description="ทุก session ของบัญชีนี้ถูกปิด เจ้าของบัญชีเข้าระบบใหม่ได้ด้วยรหัสผ่านและ OTP ตามปกติ"
        confirmLabel="ออกจากระบบทุกอุปกรณ์"
        tone="danger"
        onConfirm={async (reason) => {
          await api.remove(`/api/admin/users/${u.id}/sessions`, { reason });
          done("ปิด session ทั้งหมดแล้ว");
        }}
      />
      <IdentityDialog open={dialog === "identity"} onClose={close} user={u} onDone={() => done("เปลี่ยนตัวตนของบัญชีแล้ว")} />
      <GrantDialog
        open={dialog === "grant"}
        onClose={close}
        user={u}
        onDone={(w) => {
          setWarnings(w);
          done("มอบบทบาทแล้ว");
        }}
      />
      <TransferDialog
        open={dialog === "transfer"}
        onClose={close}
        user={u}
        current={activeRoles}
        onDone={(w) => {
          setWarnings(w);
          done("ย้ายบทบาทแล้ว");
        }}
      />
      <ActionDialog
        open={typeof dialog === "object" && dialog !== null && "revoke" in dialog}
        onClose={close}
        title="ถอนบทบาท"
        description={
          typeof dialog === "object" && dialog && "revoke" in dialog
            ? `ถอน "${ROLE_LABELS[dialog.revoke.role.code]}"${
                dialog.revoke.organization ? ` ของ ${dialog.revoke.organization.nameTh}` : ""
              } — เจ้าของบัญชีได้รับแจ้งพร้อมเหตุผล`
            : undefined
        }
        confirmLabel="ถอนบทบาท"
        tone="danger"
        reasonHint="เจ้าของบัญชีเห็นเหตุผลนี้"
        onConfirm={async (reason) => {
          if (typeof dialog !== "object" || !dialog || !("revoke" in dialog)) return;
          await api.remove(`/api/admin/users/${u.id}/roles/${dialog.revoke.id}`, { reason });
          done("ถอนบทบาทแล้ว");
        }}
      />
    </div>
  );
}

/** ปุ่มเปลี่ยนสถานะตามสถานะปัจจุบัน — ตารางเดียวกับที่ API ยอม (backend/src/routes/admin-users.ts) */
function StatusActions({
  user,
  isSelf,
  open,
}: {
  user: AdminUser;
  isSelf: boolean;
  open: (d: Dialog) => void;
}) {
  if (isSelf) return null;
  return (
    <>
      {user.status === "ACTIVE" ? (
        <>
          <Button size="sm" variant="secondary" onClick={() => open("password")}>
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open("suspend")}>
            ระงับชั่วคราว
          </Button>
        </>
      ) : null}
      {user.status === "SUSPENDED" ? (
        <Button size="sm" onClick={() => open("reinstate")}>
          ยกเลิกการระงับ
        </Button>
      ) : null}
      {user.status === "ACTIVE" || user.status === "SUSPENDED" ? (
        <Button size="sm" variant="danger" onClick={() => open("deactivate")}>
          ยุติการใช้งาน
        </Button>
      ) : null}
      {user.status === "DEACTIVATED" ? (
        <>
          {user.email.endsWith("@invalid.local") ? null : (
            <>
              <Button size="sm" onClick={() => open("reactivate")}>
                เปิดใช้อีกครั้ง
              </Button>
              <Button size="sm" variant="secondary" onClick={() => open("release")}>
                ปล่อยอีเมลให้ใช้ใหม่
              </Button>
            </>
          )}
        </>
      ) : null}
    </>
  );
}

function StatusBanner({ user }: { user: AdminUser }) {
  if (user.status === "SUSPENDED") {
    return (
      <div className="mb-5 rounded-xl bg-danger-bg px-4 py-3 text-[14px]">
        <p className="font-semibold text-danger">บัญชีถูกระงับเมื่อ {formatThaiDate(user.suspendedAt)}</p>
        {user.suspensionReason ? <p className="text-ink">เหตุผล: {user.suspensionReason}</p> : null}
      </div>
    );
  }
  if (user.status === "DEACTIVATED") {
    return (
      <div className="mb-5 rounded-xl bg-navy-50 px-4 py-3 text-[14px] text-ink">
        บัญชียุติการใช้งานเมื่อ {formatThaiDate(user.deactivatedAt)} — เข้าระบบไม่ได้และไม่มีบทบาท
      </div>
    );
  }
  if (user.status === "PENDING") {
    return (
      <div className="mb-5 rounded-xl bg-warning-bg px-4 py-3 text-[14px] text-ink">
        บัญชีนี้ยังไม่ได้เปิดใช้งาน — เจ้าของต้องกดลิงก์ในคำเชิญและยืนยันตัวตนด้วย ThaID ก่อน ดูหรือส่งคำเชิญใหม่ได้ที่แท็บการเข้าใช้งาน
      </div>
    );
  }
  return null;
}

/** ช่องที่ PATCH แก้ได้ — `email` กับ `cid` ไม่อยู่ในนี้ เปลี่ยนผ่าน "ตัวตนสำหรับเข้าระบบ" ซึ่งต้องมีเหตุผล */
const PROFILE_FIELDS = [
  ["prefixTh", "คำนำหน้า"],
  ["firstnameTh", "ชื่อ"],
  ["lastnameTh", "นามสกุล"],
  ["positionTh", "ตำแหน่ง"],
  ["departmentTh", "กอง / สำนัก"],
  ["phoneNumber", "เบอร์โทรศัพท์"],
  ["phoneNumberExtension", "เบอร์ต่อ"],
] as const;
type ProfileKey = (typeof PROFILE_FIELDS)[number][0];

function ProfilePanel({ user, onSaved }: { user: AdminUser; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<ProfileKey, string>>(() => profileOf(user));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReturnType<typeof adminErrorView> | null>(null);

  useEffect(() => {
    if (!editing) setForm(profileOf(user));
  }, [user, editing]);

  const save = async () => {
    // ส่งเฉพาะช่องที่เปลี่ยน — ช่องว่างส่งเป็น null (ล้างค่า) ไม่ใช่ "" ซึ่งจะเขียนสตริงว่างลงคอลัมน์
    const before = profileOf(user);
    const changed = Object.fromEntries(
      PROFILE_FIELDS.filter(([k]) => form[k].trim() !== before[k]).map(([k]) => [k, form[k].trim() || null]),
    );
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/admin/users/${user.id}`, changed);
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(adminErrorView(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="ข้อมูลบัญชี"
      description="ชื่อจาก ThaID แก้ได้เมื่อจำเป็นเท่านั้น — ชื่อนี้ไปปรากฏบนเอกสารข้อตกลงที่ลงนามหลังจากนี้"
      actions={
        editing ? null : (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            แก้ไข
          </Button>
        )
      }
    >
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {PROFILE_FIELDS.map(([key, label]) => (
              <TextField
                key={key}
                label={label}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                error={error?.fields[key]}
                inputMode={key.startsWith("phone") ? "numeric" : undefined}
              />
            ))}
          </div>
          {error && Object.keys(error.fields).length === 0 ? <ErrorNotice view={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              ยกเลิก
            </Button>
            <Button type="submit" loading={saving}>
              บันทึก
            </Button>
          </div>
        </form>
      ) : (
        <DetailList
          items={[
            { label: "ชื่อ-นามสกุล", value: accountName(user) === user.email ? null : accountName(user) },
            { label: "ตำแหน่ง", value: user.positionTh },
            { label: "กอง / สำนัก", value: user.departmentTh },
            { label: "เบอร์โทรศัพท์", value: phoneWithExtension(user.phoneNumber, user.phoneNumberExtension) },
            { label: "เข้าระบบล่าสุด", value: user.lastLoginAt ? formatThaiDate(user.lastLoginAt) : "ยังไม่เคยเข้าระบบ" },
          ]}
        />
      )}
    </Panel>
  );
}

function profileOf(user: AdminUser): Record<ProfileKey, string> {
  return Object.fromEntries(PROFILE_FIELDS.map(([k]) => [k, user[k] ?? ""])) as Record<ProfileKey, string>;
}

function RolesPanel({
  detail,
  isSelf,
  onGrant,
  onTransfer,
  onRevoke,
}: {
  detail: AdminUserDetail;
  isSelf: boolean;
  onGrant: () => void;
  onTransfer: () => void;
  onRevoke: (a: AdminRoleAssignment) => void;
}) {
  const active = detail.roleAssignments.filter((a) => a.derivedStatus === "ACTIVE");
  const past = detail.roleAssignments.filter((a) => a.derivedStatus !== "ACTIVE");
  const canChange = detail.user.status === "ACTIVE" && !isSelf;

  return (
    <>
      <Panel
        title="บทบาทปัจจุบัน"
        description="หนึ่งบัญชีมีได้หนึ่งบทบาท — เปลี่ยนบทบาทหรือหน่วยงานด้วย “ย้าย” ซึ่งถอนของเดิมและมอบของใหม่ในคำสั่งเดียว"
        actions={
          canChange ? (
            active.length === 0 ? (
              <Button size="sm" onClick={onGrant}>
                มอบบทบาท
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={onTransfer}>
                ย้ายหน่วยงาน / เปลี่ยนบทบาท
              </Button>
            )
          ) : null
        }
        flush
      >
        {active.length === 0 ? (
          <EmptyState title="บัญชีนี้ยังไม่มีบทบาท">
            {detail.user.status === "ACTIVE" ? "มอบบทบาทเพื่อให้บัญชีนี้ทำงานในระบบได้" : "บัญชีต้องใช้งานอยู่จึงจะมอบบทบาทได้"}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium text-navy-800">{ROLE_LABELS[a.role.code] ?? a.role.nameTh}</p>
                  {a.organization ? (
                    <Link href={`/console/organizations/${a.organization.id}`} className="text-[13.5px] text-navy-600 hover:underline">
                      {a.organization.nameTh}
                    </Link>
                  ) : null}
                  {a.effectiveFrom ? (
                    <p className="text-[12.5px] text-ink-muted">ตั้งแต่ {formatThaiDate(a.effectiveFrom)}</p>
                  ) : null}
                </div>
                {canChange ? (
                  <Button size="sm" variant="ghost" onClick={() => onRevoke(a)}>
                    ถอนบทบาท
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {past.length > 0 ? (
        <Panel title="บทบาทที่เคยมี" flush>
          <ul className="divide-y divide-line">
            {past.map((a) => (
              <li key={a.id} className="px-5 py-3 text-[14px]">
                <p className="text-ink">
                  {ROLE_LABELS[a.role.code] ?? a.role.nameTh}
                  {a.organization ? <span className="text-ink-muted"> · {a.organization.nameTh}</span> : null}
                </p>
                <p className="text-[13px] text-ink-muted">
                  ถอนเมื่อ {formatThaiDate(a.revokedAt)}
                  {a.revocationReason ? ` · ${a.revocationReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function RoleSelect({ value, onChange, roles }: { value: string; onChange: (r: Role) => void; roles: Role[] }) {
  return (
    <SelectField label="บทบาท" required value={value} onChange={(e) => onChange(e.target.value as Role)}>
      <option value="">เลือกบทบาท</option>
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </SelectField>
  );
}

function GrantDialog({
  open,
  onClose,
  user,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  user: AdminUser;
  onDone: (warnings: string[]) => void;
}) {
  const [role, setRole] = useState<Role | "">("");
  const [org, setOrg] = useState("");
  useEffect(() => {
    if (open) {
      setRole("");
      setOrg("");
    }
  }, [open]);
  const scoped = role !== "" && ORGANIZATION_ROLES.includes(role);
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="มอบบทบาท"
      description={`มอบบทบาทให้ ${accountName(user)} — บทบาทของ BDI ผูกกับหน่วยงาน BDI เสมอ`}
      confirmLabel="มอบบทบาท"
      reasonHint="เจ้าของบัญชีเห็นเหตุผลนี้"
      canSubmit={role !== "" && (!scoped || org !== "")}
      onConfirm={async (reason) => {
        const res = await api.post<{ replacedUserAccountIds?: string[] }>(`/api/admin/users/${user.id}/roles`, {
          role,
          ...(scoped ? { organizationId: org } : {}),
          reason,
        });
        onDone(
          res.replacedUserAccountIds && res.replacedUserAccountIds.length > 0
            ? [`ผู้ถือตำแหน่งเดิม ${res.replacedUserAccountIds.length} บัญชีถูกถอนบทบาทเพราะบัญชีของเขาไม่ได้ใช้งานอยู่`]
            : [],
        );
      }}
    >
      <RoleSelect value={role} onChange={setRole} roles={[...ORGANIZATION_ROLES, ...BDI_ROLE_CODES]} />
      {scoped ? <OrganizationPicker value={org} onChange={setOrg} required /> : null}
    </ActionDialog>
  );
}

function TransferDialog({
  open,
  onClose,
  user,
  current,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  user: AdminUser;
  current: AdminRoleAssignment[];
  onDone: (warnings: string[]) => void;
}) {
  const [role, setRole] = useState<Role | "">("");
  const [org, setOrg] = useState("");
  useEffect(() => {
    if (open) {
      setRole("");
      setOrg("");
    }
  }, [open]);
  const now = current[0];
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="ย้ายหน่วยงาน / เปลี่ยนบทบาท"
      description={`ถอนบทบาทปัจจุบัน${now ? ` (${ROLE_LABELS[now.role.code]}${now.organization ? ` · ${now.organization.nameTh}` : ""})` : ""} แล้วมอบบทบาทใหม่ในคำสั่งเดียว คำขอที่ค้างอยู่กับบัญชีนี้ถูกคืนเป็นฉบับร่าง — ย้ายไปบทบาทของ BDI ทำไม่ได้ที่นี่ ให้ถอนบทบาทเดิมแล้วมอบใหม่`}
      confirmLabel="ย้าย"
      reasonHint="เจ้าของบัญชีและหน่วยงานเดิมเห็นเหตุผลนี้"
      canSubmit={role !== "" && org !== ""}
      onConfirm={async (reason) => {
        const res = await api.post<{ requestsRevertedToDraft?: unknown[]; organizationsLeftWithoutStaff?: unknown[]; message?: string }>(
          `/api/admin/users/${user.id}/transfer`,
          { organizationId: org, role, reason },
        );
        const w: string[] = [];
        if (res.requestsRevertedToDraft?.length) w.push(`คำขอ ${res.requestsRevertedToDraft.length} ใบถูกคืนเป็นฉบับร่าง`);
        if (res.organizationsLeftWithoutStaff?.length) {
          w.push(`หน่วยงานเดิม ${res.organizationsLeftWithoutStaff.length} แห่งไม่เหลือผู้ใช้ — เชิญผู้ประสานงานคนใหม่ให้หน่วยงานนั้น`);
        }
        onDone(w);
      }}
    >
      <RoleSelect value={role} onChange={setRole} roles={ORGANIZATION_ROLES} />
      <OrganizationPicker value={org} onChange={setOrg} label="หน่วยงานปลายทาง" required />
    </ActionDialog>
  );
}

function IdentityDialog({
  open,
  onClose,
  user,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  user: AdminUser;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [cid, setCid] = useState(user.cid ?? "");
  useEffect(() => {
    if (open) {
      setEmail(user.email);
      setCid(user.cid ?? "");
    }
  }, [open, user]);
  const changed = email.trim().toLowerCase() !== user.email || cid.trim() !== (user.cid ?? "");
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="เปลี่ยนอีเมลหรือเลขบัตรประชาชน"
      description="เจ้าของบัญชีถูกออกจากระบบทุกอุปกรณ์ และเข้าระบบครั้งถัดไปด้วยอีเมลใหม่ — ตรวจเลขบัตรกับเอกสารที่หน่วยงานส่งมาก่อนบันทึก"
      confirmLabel="บันทึกการเปลี่ยนแปลง"
      tone="danger"
      confirmPhrase={user.email}
      canSubmit={changed}
      onConfirm={async (reason) => {
        await api.post(`/api/admin/users/${user.id}/identity`, {
          ...(email.trim().toLowerCase() !== user.email ? { email: email.trim() } : {}),
          ...(cid.trim() !== (user.cid ?? "") ? { cid: cid.trim() } : {}),
          reason,
        });
        onDone();
      }}
    >
      <TextField label="อีเมล" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <TextField
        label="เลขประจำตัวประชาชน"
        inputMode="numeric"
        maxLength={13}
        value={cid}
        onChange={(e) => setCid(e.target.value.replace(/\D/g, ""))}
      />
    </ActionDialog>
  );
}
