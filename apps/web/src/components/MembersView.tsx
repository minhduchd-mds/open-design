// Team members management view (demo).
//
// UC-2 entry point 4 (team members) + role management. Demo-only:
// all data is hard-coded Chinese mock content, no backend. The
// "邀请同事" button opens the shared <InviteDialog> (self-owned open
// state), and each member's role is a controlled <select> so the
// dropdowns stay interactive for the review.

import { useState } from 'react';
import { Icon } from './Icon';
import { InviteDialog } from './InviteDialog';

type Role = '所有者' | '管理员' | '成员';

interface Member {
  id: string;
  name: string;
  email: string;
  img: string;
  role: Role;
  /** The current viewer ("你") — owner row, role select is disabled,
   *  and there is no "移除" action. */
  isYou?: boolean;
}

// Unified mock team (kept in sync with RecentProjectsStrip MOCK_MEMBERS).
const MOCK_MEMBERS: Member[] = [
  { id: 'qy', name: '琼羽（你）', email: 'qiongyu@nexu.io', img: '/team-avatars/a2.png', role: '所有者', isYou: true },
  { id: 'zw', name: '张伟', email: 'zhangwei@nexu.io', img: '/team-avatars/a1.png', role: '管理员' },
  { id: 'ln', name: '李娜', email: 'lina@nexu.io', img: '/team-avatars/a3.png', role: '成员' },
  { id: 'wf', name: '王芳', email: 'wangfang@nexu.io', img: '/team-avatars/a4.png', role: '成员' },
  { id: 'cm', name: '陈明', email: 'chenming@nexu.io', img: '/team-avatars/a6.png', role: '成员' },
  { id: 'ly', name: '刘洋', email: 'liuyang@nexu.io', img: '/team-avatars/a7.png', role: '成员' },
];

const ROLE_OPTIONS: Role[] = ['所有者', '管理员', '成员'];

export function MembersView() {
  const [inviteOpen, setInviteOpen] = useState(false);
  // Per-member role state so the dropdowns are interactive in the demo.
  const [roles, setRoles] = useState<Record<string, Role>>(() =>
    Object.fromEntries(MOCK_MEMBERS.map((m) => [m.id, m.role])),
  );

  function setRole(id: string, role: Role) {
    setRoles((prev) => ({ ...prev, [id]: role }));
  }

  return (
    <div className="entry-section members">
      <header className="entry-section__head members__head">
        <div className="members__head-text">
          <h1 className="entry-section__title">成员</h1>
          <p className="members__subtitle">管理 Nexu 团队的成员与角色</p>
        </div>
        <button
          type="button"
          className="members__invite-btn"
          onClick={() => setInviteOpen(true)}
        >
          <Icon name="share" size={15} /> 邀请同事
        </button>
      </header>

      <div className="members__seats">
        <Icon name="info" size={14} />
        <span>
          席位 <strong>3/3</strong> 已用 · 团队版默认含 3 个席位
        </span>
      </div>

      <div className="members__panel">
        <div className="members__list-head" aria-hidden>
          <span className="members__col members__col--person">成员</span>
          <span className="members__col members__col--role">角色</span>
          <span className="members__col members__col--action" />
        </div>

        {MOCK_MEMBERS.map((member) => {
          const role = roles[member.id] ?? member.role;
          return (
            <div className="members__row" key={member.id}>
              <div className="members__col members__col--person">
                <img className="members__avatar" src={member.img} alt="" aria-hidden />
                <div className="members__person-text">
                  <span className="members__name">
                    {member.name}
                    {member.isYou ? <span className="members__you-tag">你</span> : null}
                  </span>
                  <span className="members__email">{member.email}</span>
                </div>
              </div>

              <div className="members__col members__col--role">
                <select
                  className="members__role-select"
                  value={role}
                  disabled={member.isYou}
                  aria-label={`${member.name} 的角色`}
                  onChange={(e) => setRole(member.id, e.target.value as Role)}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="members__col members__col--action">
                {member.isYou ? null : (
                  <button type="button" className="members__remove">
                    <Icon name="trash" size={14} /> 移除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="members__pending">
        <h2 className="members__pending-title">待接受邀请 · 1</h2>
        <div className="members__panel">
          <div className="members__row members__row--pending">
            <div className="members__col members__col--person">
              <span className="members__avatar members__avatar--placeholder" aria-hidden>
                <Icon name="send" size={14} />
              </span>
              <div className="members__person-text">
                <span className="members__name">li@example.com</span>
                <span className="members__email">角色：成员</span>
              </div>
            </div>
            <div className="members__col members__col--role">
              <span className="members__badge">待接受</span>
            </div>
            <div className="members__col members__col--action">
              <button type="button" className="members__resend">
                <Icon name="refresh" size={13} /> 重新发送
              </button>
            </div>
          </div>
        </div>
      </div>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
