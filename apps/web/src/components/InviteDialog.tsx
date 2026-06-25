// Reusable "invite teammates" dialog for the team workspace.
//
// Extracted from EntryNavRail so multiple entry points (the team dropdown
// in the left rail and the "全部项目" team header) can share one modal.
// Demo-only: all data is hard-coded Chinese mock content, no backend.

import { useState } from 'react';
import { Icon } from './Icon';

interface Props {
  open: boolean;
  onClose: () => void;
}

const MOCK_MEMBERS = [
  { name: '琼羽（你）', img: '/team-avatars/a2.png', role: '所有者' },
  { name: '张伟', img: '/team-avatars/a1.png', role: '管理员' },
  { name: '李娜', img: '/team-avatars/a3.png', role: '成员' },
  { name: '王芳', img: '/team-avatars/a4.png', role: '成员' },
  { name: '陈明', img: '/team-avatars/a6.png', role: '成员' },
  { name: '刘洋', img: '/team-avatars/a7.png', role: '成员' },
];

export function InviteDialog({ open, onClose }: Props) {
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('成员');

  if (!open) return null;

  return (
    <div className="entry-invite" role="dialog" aria-modal="true" aria-label="邀请同事">
      <div className="entry-invite__backdrop" onClick={onClose} />
      <div className="entry-invite__panel">
        <div className="entry-invite__head">
          <span className="entry-invite__team-avatar" aria-hidden>N</span>
          <div className="entry-invite__head-text">
            <h2 className="entry-invite__title">邀请同事加入 Nexu 团队</h2>
            <p className="entry-invite__subtitle">受邀成员可以查看并协作团队空间内的所有项目</p>
          </div>
        </div>

        <label className="entry-invite__label" htmlFor="entry-invite-emails">邮箱地址</label>
        <div className="entry-invite__row">
          <textarea
            id="entry-invite-emails"
            className="entry-invite__input"
            placeholder="输入邮箱，多个用逗号或换行分隔"
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
            rows={3}
          />
          <select
            className="entry-invite__role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            aria-label="成员角色"
          >
            <option value="管理员">管理员</option>
            <option value="成员">成员</option>
          </select>
        </div>

        <div className="entry-invite__link-block">
          <span className="entry-invite__link-icon" aria-hidden><Icon name="link" size={15} /></span>
          <div className="entry-invite__link-text">
            <strong>通过链接邀请</strong>
            <span>https://open.design/invite/nexu-team-4f2a</span>
          </div>
          <button type="button" className="entry-invite__copy">
            <Icon name="copy" size={14} /> 复制链接
          </button>
        </div>

        <div className="entry-invite__members">
          <div className="entry-invite__members-title">团队成员 · {MOCK_MEMBERS.length}</div>
          {MOCK_MEMBERS.map((member) => (
            <div className="entry-invite__member" key={member.name}>
              <img
                className="entry-invite__member-avatar"
                src={member.img}
                alt=""
                aria-hidden
              />
              <span className="entry-invite__member-name">{member.name}</span>
              <span className="entry-invite__member-role">{member.role}</span>
            </div>
          ))}
        </div>

        <div className="entry-invite__foot">
          <button type="button" className="entry-invite__btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="entry-invite__btn is-primary" onClick={onClose}>
            <Icon name="send" size={14} /> 发送邀请
          </button>
        </div>
      </div>
    </div>
  );
}
