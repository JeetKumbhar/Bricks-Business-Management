import { useNavigate } from "react-router-dom";
import { Banknote, Clock, Truck, UserCheck, Users, UserX, Wallet, Ban } from "lucide-react";
import { StatCard } from "../../components/ui";
import { formatCurrency } from "../../utils/formatCurrency";

/** The 8 summary cards at the top of the Dashboard. */
export default function DashboardStats({ summary, weeklyPaymentsTotal }) {
  const navigate = useNavigate();
  const { trucks } = summary;

  const cards = [
    { title: "Total Labour", value: summary.totalLabour, icon: Users, color: "blue", action: "View All", to: "/labours" },
    { title: "Present Today", value: summary.presentToday, icon: UserCheck, color: "green", action: "View All", to: "/attendance" },
    { title: "Half Day", value: summary.halfDayToday, icon: Clock, color: "yellow", action: "View All", to: "/attendance" },
    { title: "Absent", value: summary.absentToday, icon: UserX, color: "red", action: "View All", to: "/attendance" },
    { title: "Working Trucks", value: `${trucks.working} / ${trucks.total}`, icon: Truck, color: "purple", action: "View All", to: "/trucks" },
    { title: "Stopped Trucks", value: trucks.stopped, icon: Ban, color: "red", variant: "soft", action: "View All", to: "/trucks" },
    // Money values are long, so these two take the full row on phones.
    { title: "Pending Salary", value: formatCurrency(summary.pendingSalary), icon: Banknote, color: "blue", variant: "soft", action: "View Salary", to: "/salary", wide: true },
    { title: "Weekly Payments", value: formatCurrency(weeklyPaymentsTotal), icon: Wallet, color: "green", variant: "soft", action: "View Payments", to: "/payments", wide: true },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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
