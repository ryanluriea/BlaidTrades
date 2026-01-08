import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Plus, Send, MessageSquare, Mail } from "lucide-react";

export function WebhooksSection() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Webhooks & Notifications</CardTitle>
          </div>
          <Button size="sm" disabled>
            <Plus className="w-4 h-4 mr-1" />
            Add Webhook
          </Button>
        </div>
        <CardDescription>
          External notifications for alerts, trades, and system events
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8 text-muted-foreground">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm font-medium">No webhooks configured</p>
          <p className="text-xs mt-1 mb-4">
            Add Discord, Slack, or email webhooks for external notifications
          </p>
          
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" disabled>
              <MessageSquare className="w-4 h-4 mr-1" />
              Discord
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Send className="w-4 h-4 mr-1" />
              Slack
            </Button>
            <Button variant="outline" size="sm" disabled>
              <Mail className="w-4 h-4 mr-1" />
              Email
            </Button>
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
          <p className="font-medium mb-1">Coming Soon</p>
          <p>
            Webhook notifications will allow you to receive real-time alerts about trades, 
            promotions, risk events, and system status via Discord, Slack, or email.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
