import { useNavigate } from "react-router-dom";
import { Banknote, Boxes, Factory, Layers, Truck, UserCheck, Wallet } from "lucide-react";
import { StatCard } from "../../components/ui";
import { todayBusinessDate } from "../../utils/businessDate";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { filterPheeras } from "../trucks/pheeraSelectors";
import useTruckTrips from "../trucks/useTruckTrips";

/**
 * The dashboard cards, in priority order. First row (shortcut cards): attendance, maaps, Patlavale production and Truck Pheera
 * entry. Second row: total bricks, then money.
 * Every value comes from the same records as the other pages (see dashboardSelectors.js); nothing is typed in by hand.
 * - Bigari Present counts status PRESENT only (half days are not counted). Attendance is Bigari only.
 * - Production Today is Patlavale MAAPS recorded today (not bricks). Total Bricks is PHYSICAL bricks (275 per maap) for the
 *   whole season; payments never change it. Payable bricks (250 per maap) are shown in the production section below.
 * - Outstanding and Paid Last 7 Days use the payments that are not deleted (reversed), the same as the Payments page.
 * - Truck Pheera shows the Pheera (truck trips) recorded today and opens Trucks > Daily Entry (/trucks?tab=entry).
 * The whole card is clickable.
 */
export default function DashboardStats({ attendanceToday, maap, production, money }) {
  const navigate = useNavigate();
  const { rows: pheeraRows } = useTruckTrips();
  const pheeraToday = filterPheeras(pheeraRows, { date: todayBusinessDate() }).length;

  // First row: the cards that lead straight to a daily task.
  const actionCards = [
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
      tag: "Transport",
      title: "Truck Pheera Today",
      value: `${formatNumber(pheeraToday)} Pheera`,
      caption: "Truck trips recorded today",
      icon: Truck,
      color: "blue",
      action: "Truck Pheera Entry",
      to: "/trucks?tab=entry",
    },
  ];

  // Second row: totals and money.
  const summaryCards = [
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
      wide: true,
    },
    // Money values are long, so these take the full row on phones.
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

  const renderCard = (card) => (
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
  );

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">{actionCards.map(renderCard)}</div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">{summaryCards.map(renderCard)}</div>
    </div>
  );
}
