import { useState } from "react";
import { CheckCircle, Clock, WarningCircle, XCircle } from "@phosphor-icons/react";

const niceMax = (value) => { for (const step of [2, 4, 6, 8, 10, 12, 16, 20, 30, 40, 60, 80, 100]) if (value <= step) return step; return Math.ceil(value / 50) * 50; };

export function StatTile({ label, value, delta, tone = "flat", primary = false, trend, action }) {
  return <div className="usage-tile" data-primary={primary}>
    <dt>{label}</dt>
    <dd>{value}</dd>
    {delta && <p data-tone={tone}>{delta}</p>}
    {trend && <span className="usage-mini" aria-hidden="true">{trend.map((item, index) => <i key={index} style={{ height: `${Math.max((item / Math.max(...trend, 1)) * 100, 6)}%` }} />)}</span>}
    {action}
  </div>;
}

export function TrendChart({ buckets, onSelect }) {
  const [active, setActive] = useState(null);
  const max = niceMax(Math.max(...buckets.flatMap((bucket) => [bucket.protected, bucket.restored]), 1));
  const every = Math.ceil(buckets.length / 6);
  const hovered = active === null ? null : buckets[active];
  return <figure className="usage-trend">
    <figcaption>
      <h2>处理趋势</h2>
      <ul className="usage-legend"><li data-series="protect">脱敏任务</li><li data-series="restore">还原任务</li></ul>
    </figcaption>
    <div className="usage-trend__plot" onMouseLeave={() => setActive(null)}>
      <div className="usage-trend__grid" aria-hidden="true">{[max, max / 2, 0].map((tick) => <span key={tick}><i>{tick}</i></span>)}</div>
      <div className="usage-trend__bars">{buckets.map((bucket, index) => <div key={bucket.day} className="usage-trend__slot">
        <button type="button" className="usage-trend__column" data-active={active === index} aria-label={`${bucket.label}：脱敏 ${bucket.protected} 个，还原 ${bucket.restored} 个，查看明细`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => onSelect(bucket)}>
          <i data-series="protect" style={{ height: `${(bucket.protected / max) * 100}%` }} />
          <i data-series="restore" style={{ height: `${(bucket.restored / max) * 100}%` }} />
        </button>
        <small>{index % every === 0 ? bucket.label : ""}</small>
      </div>)}</div>
      {hovered && <div className="usage-tooltip" style={{ left: `calc(30px + (100% - 30px) * ${(active + 0.5) / buckets.length})` }} data-flip={active > buckets.length * 0.65}><strong>{hovered.label}</strong><span data-series="protect">脱敏 <b>{hovered.protected}</b></span><span data-series="restore">还原 <b>{hovered.restored}</b></span></div>}
    </div>
  </figure>;
}

const OUTCOME_ICONS = { partial: WarningCircle, missing: WarningCircle, failed: XCircle, waiting: Clock };

export function OutcomeCard({ rate, issues, onSelect }) {
  const circumference = 2 * Math.PI * 44;
  return <figure className="usage-outcomes">
    <figcaption><h2>处理结果</h2></figcaption>
    <div className="usage-rate">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" /><circle cx="50" cy="50" r="44" data-value="true" strokeDasharray={`${(rate / 100) * circumference} ${circumference}`} /></svg>
      <p><strong>{rate}%</strong><span>完成率</span></p>
    </div>
    {issues.length ? <ul className="usage-issues">{issues.map(({ key, label, count }) => { const Icon = OUTCOME_ICONS[key]; return <li key={key} data-status={key}>
      <button type="button" aria-label={`查看${label}的明细，共 ${count} 项`} onClick={() => onSelect(key, label)}><Icon aria-hidden="true" weight="fill" /><span>{label}</span><b>{count}</b></button>
    </li>; })}</ul> : <p className="usage-clear"><CheckCircle aria-hidden="true" weight="fill" />没有需要关注的异常</p>}
  </figure>;
}

export function RankBars({ title, items, unit, onSelect }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return <figure className="usage-rank">
    <figcaption><h2>{title}</h2></figcaption>
    <ul className="usage-bars">{items.map(({ key, label, count }) => <li key={key}>
      <button type="button" aria-label={`查看${label}的明细，${count} ${unit}`} onClick={() => onSelect(key, label)}>
        <span className="usage-bars__label">{label}</span>
        <b>{count} <small>{unit}</small></b>
        <span className="usage-bars__track"><i style={{ width: `${(count / max) * 100}%` }} /></span>
      </button>
    </li>)}</ul>
  </figure>;
}
