import { useNavigate } from "react-router-dom";
import { Banknote, Boxes, UserCheck, Users, Wallet } from "lucide-react";
import { StatCard } from "../../components/ui";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

/**
 * Summary cards. Attendance cards say "Bigari": attendance is not recorded for Maapvali or Patlavale,
 * so those types are never counted in them. Patlavale production has its own section below.
 */
export default function DashboardStats({ workers, attendanceToday, maap, money }) {
  const navigate = useNavigate();
  const anyMarked = attendanceToday.marked > 0;

  const cards = [
    { title: "Bigari Active", value: workers.bigariActive, icon: Users, color: "blue", action: "View Labour", to: "/labours" },
    {
      title: "Bigari Present Today",
      // nothing marked yet: show a dash instead of a misleading 0
      value: anyMarked ? attendanceToday.present : "-",
      icon: UserCheck,
      color: "green",
      action: anyMarked ? "View Attendance" : "Mark Attendance",
      to: "/attendance",
    },
    { title: "Maapvali Active", value: workers.maapvaliActive, icon: Boxes, color: "purple", action: "View Work", to: "/maapvali-work" },
    { title: "Maaps Today", value: formatNumber(maap.todayMaaps), icon: Boxes, color: "purple", variant: "soft", action: "Add Work", to: "/maapvali-work" },
    // Money values are long, so these two take the full row on phones.
    {
      title: "Total Outstanding Balance",
      value: formatCurrency(money.outstanding),
      icon: Banknote,
      color: "red",
      variant: "soft",
      action: "View Payments",
      to: "/payments",
      wide: true,
    },
    {
      title: "Paid Last 7 Days",
      value: formatCurrency(money.paidLast7),
      icon: Wallet,
      color: "green",
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
          title={card.title}
          value={card.value}
          icon={card.icon}
          color={card.color}
          variant={card.variant ?? "solid"}
          actionLabel={card.action}
          onAction={() => navigate(card.to)}
          className={card.wide ? "col-span-2 flex-row items-center gap-3 lg:col-span-1" : undefined}
        />
      ))}
    </div>
  );
}
