import { useNavigate } from "react-router-dom";
import { Banknote, Boxes, Factory, Layers, UserCheck, Wallet } from "lucide-react";
import { StatCard } from "../../components/ui";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

/**
 * The six dashboard summary cards, in priority order: operations (attendance, maaps), production, then money.
 * Every value comes from the same records as the other pages (see dashboardSelectors.js); nothing is typed in by hand.
 * - Bigari Present counts status PRESENT only (half days are not counted). Attendance is Bigari only.
 * - Production Today is Patlavale MAAPS recorded today (not bricks). Total Bricks is PHYSICAL bricks (275 per maap) for the
 *   whole season; payments never change it. Payable bricks (250 per maap) are shown in the production section below.
 * - Outstanding and Paid Last 7 Days use the payments that are not deleted (reversed), the same as the Payments page.
 * The whole card is clickable.
 */
export default function DashboardStats({ attendanceToday, maap, production, money }) {
  const navigate = useNavigate();

  const cards = [
    {
      tag: "Operations",
      title: "Bigari Present Today",
      value: formatNumber(attendanceToday.present),
      caption: attendanceToday.marked > 0 ? `${attendanceToday.marked} of ${attendanceToday.roster} marked` : "Attendance not marked yet",
      icon: UserCheck,
      color: "green",
      action: "Mark Attendance",
      to: "/attendance",
    },
    {
      tag: "Operations",
      title: "Maaps Today",
      value: formatNumber(maap.todayMaaps),
      caption: "Maapvali maaps recorded today",
      icon: Boxes,
      color: "purple",
      action: "Maapvali Work",
      to: "/maapvali-work",
    },
    {
      tag: "Production",
      title: "Bricks Production Today",
      value: `${formatNumber(production.todayMaaps)} maaps`,
      caption: "Patlavale maaps recorded today (not bricks)",
      icon: Factory,
      color: "yellow",
      action: "Patlavale Production",
      to: "/patlavale-production",
    },
    {
      tag: "Production",
      title: "Total Bricks Produced Till Date",
      value: formatNumber(production.season.totalPhysicalBricks),
      caption: "Physical bricks this season (275 per maap)",
      icon: Layers,
      color: "yellow",
      variant: "soft",
      action: "View Production",
      to: "/patlavale-production",
    },
    // Money values are long, so these two take the full row on phones.
    {
      tag: "Finance",
      title: "Total Outstanding Balance",
      value: formatCurrency(money.outstanding),
      caption: "All labour categories",
      icon: Banknote,
      color: "red",
      variant: "soft",
      action: "View Payments",
      to: "/payments",
      wide: true,
    },
    {
      tag: "Finance",
      title: "Paid Last 7 Days",
      value: formatCurrency(money.paidLast7),
      caption: "Including today",
      icon: Wallet,
      color: "blue",
      variant: "soft",
      action: "View Payments",
      to: "/payments",
      wide: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {cards.map((card) => (
        <StatCard
          key={card.title}
          tag={card.tag}
          title={card.title}
          value={card.value}
          caption={card.caption}
          icon={card.icon}
          color={card.color}
          variant={card.variant ?? "solid"}
          actionLabel={card.action}
          onCardClick={() => navigate(card.to)}
          className={card.wide ? "col-span-2 flex-row items-center gap-3 lg:col-span-1" : undefined}
        />
      ))}
    </div>
  );
}
