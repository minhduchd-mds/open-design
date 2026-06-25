// Content plan view (demo). A team content scheduling calendar — UC-9b.
//
// This is a review-only demo surface: a Canva/Notion-style weekly content
// calendar that team operations use to plan & schedule published content
// (公众号 / 小红书 / X / 视频号). It is intentionally static: the "新建内容"
// button and the 周/月 view switch are presentational only. All data below is
// hard-coded Chinese mock data, deliberately not wired to i18n or a backend.

import { useState } from 'react';
import { Icon } from './Icon';

// Shared mock team members (kept consistent with RecentProjectsStrip.tsx).
const MEMBERS = {
  qiong: { name: '琼羽', initial: '琼', img: '/team-avatars/a2.png' },
  zhangwei: { name: '张伟', initial: '张', img: '/team-avatars/a1.png' },
  lina: { name: '李娜', initial: '李', img: '/team-avatars/a3.png' },
  wangfang: { name: '王芳', initial: '王', img: '/team-avatars/a4.png' },
  chenming: { name: '陈明', initial: '陈', img: '/team-avatars/a6.png' },
  liuyang: { name: '刘洋', initial: '刘', img: '/team-avatars/a7.png' },
} as const;

type Channel = 'wechat' | 'xhs' | 'x' | 'video';
const CHANNEL_LABEL: Record<Channel, string> = {
  wechat: '公众号',
  xhs: '小红书',
  x: 'X',
  video: '视频号',
};

type CardStatus = 'draft' | 'review' | 'scheduled' | 'published';
const STATUS_LABEL: Record<CardStatus, string> = {
  draft: '草稿',
  review: '待审',
  scheduled: '已排期',
  published: '已发布',
};

interface ContentCard {
  channel: Channel;
  title: string;
  status: CardStatus;
  owner: { name: string; initial: string; img: string };
}

// Week column headers (周一~周日) with their dates (6/23 ~ 6/29).
const WEEK_DAYS: { weekday: string; date: string; today?: boolean }[] = [
  { weekday: '周一', date: '6/23' },
  { weekday: '周二', date: '6/24', today: true },
  { weekday: '周三', date: '6/25' },
  { weekday: '周四', date: '6/26' },
  { weekday: '周五', date: '6/27' },
  { weekday: '周六', date: '6/28' },
  { weekday: '周日', date: '6/29' },
] as const;

// 0~2 cards per day, spread across the week (7 cards total).
const WEEK_CARDS: ContentCard[][] = [
  // 周一
  [
    { channel: 'wechat', title: '6月新版本预热', status: 'scheduled', owner: MEMBERS.zhangwei },
  ],
  // 周二
  [
    { channel: 'xhs', title: '设计系统组件实拍', status: 'review', owner: MEMBERS.lina },
    { channel: 'x', title: 'Changelog 速递', status: 'draft', owner: MEMBERS.chenming },
  ],
  // 周三
  [
    { channel: 'video', title: '产品上手 30 秒短片', status: 'draft', owner: MEMBERS.wangfang },
  ],
  // 周四
  [],
  // 周五
  [
    { channel: 'wechat', title: '设计系统上线公告', status: 'scheduled', owner: MEMBERS.qiong },
    { channel: 'xhs', title: '配色灵感合辑', status: 'review', owner: MEMBERS.liuyang },
  ],
  // 周六
  [],
  // 周日
  [
    { channel: 'x', title: '社区周报 #18', status: 'published', owner: MEMBERS.chenming },
  ],
];

export function ContentPlanView() {
  // Presentational-only view switch; defaults to "周".
  const [range, setRange] = useState<'week' | 'month'>('week');

  return (
    <section className="content-plan">
      <header className="content-plan__head">
        <div className="content-plan__head-text">
          <h1 className="content-plan__title">内容规划</h1>
          <p className="content-plan__subtitle">团队内容的排期与规划</p>
        </div>
        <div className="content-plan__head-actions">
          <div className="content-plan__range" role="group" aria-label="视图切换">
            <button
              type="button"
              className={`content-plan__range-btn${range === 'week' ? ' is-active' : ''}`}
              aria-pressed={range === 'week'}
              onClick={() => setRange('week')}
            >
              周
            </button>
            <button
              type="button"
              className={`content-plan__range-btn${range === 'month' ? ' is-active' : ''}`}
              aria-pressed={range === 'month'}
              onClick={() => setRange('month')}
            >
              月
            </button>
          </div>
          <button type="button" className="content-plan__new">
            <Icon name="plus" size={15} />
            新建内容
          </button>
        </div>
      </header>

      <div className="content-plan__calendar" role="grid" aria-label="本周内容排期">
        {WEEK_DAYS.map((day, index) => {
          const cards = WEEK_CARDS[index] ?? [];
          return (
            <div
              key={day.weekday}
              className={`content-plan__col${day.today ? ' is-today' : ''}`}
              role="gridcell"
            >
              <div className="content-plan__col-head">
                <span className="content-plan__col-weekday">{day.weekday}</span>
                <span className="content-plan__col-date">{day.date}</span>
              </div>
              <div className="content-plan__col-body">
                {cards.map((card, cardIndex) => (
                  <article
                    key={`${day.weekday}-${cardIndex}`}
                    className={`content-plan__card content-plan__card--${card.channel}`}
                  >
                    <span className="content-plan__channel">
                      {CHANNEL_LABEL[card.channel]}
                    </span>
                    <h3 className="content-plan__card-title">{card.title}</h3>
                    <div className="content-plan__card-foot">
                      <span className={`content-plan__badge content-plan__badge--${card.status}`}>
                        {STATUS_LABEL[card.status]}
                      </span>
                      <span
                        className="content-plan__owner"
                        title={card.owner.name}
                        aria-label={card.owner.name}
                      >
                        {card.owner.img ? (
                          <img src={card.owner.img} alt="" loading="lazy" />
                        ) : (
                          card.owner.initial
                        )}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
