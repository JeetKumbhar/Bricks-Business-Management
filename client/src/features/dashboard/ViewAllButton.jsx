import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui";

export default function ViewAllButton({ to, label = "View All" }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="sm"
      rightIcon={ArrowRight}
      onClick={() => navigate(to)}
      className="text-primary hover:text-primary"
    >
      {label}
    </Button>
  );
}
