import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

interface ComingSoonViewProps {
  title: string;
}

export function ComingSoonView({ title }: ComingSoonViewProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12">
        <Construction className="w-10 h-10 text-muted-foreground mb-3" />
        <h3 className="text-base font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </CardContent>
    </Card>
  );
}
