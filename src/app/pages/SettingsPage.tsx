import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/app/components/ui/tabs';
import { Settings, Users, FileText, CreditCard, AlertTriangle } from 'lucide-react';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Manage system configuration and preferences</p>
      </div>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-6">
          <p className="text-sm text-slate-700">
            <strong>Admin Only:</strong> These settings control system-wide behavior and access permissions.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            Users & Roles
          </TabsTrigger>
          <TabsTrigger value="procedures" className="gap-2">
            <FileText className="h-4 w-4" />
            Procedures
          </TabsTrigger>
          <TabsTrigger value="commission" className="gap-2">
            <Settings className="h-4 w-4" />
            Commission Rules
          </TabsTrigger>
          <TabsTrigger value="banking" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Banking
          </TabsTrigger>
          <TabsTrigger value="limits" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Debt Limits
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage users and their roles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Admin User</p>
                    <p className="text-sm text-slate-600">admin@company.com</p>
                  </div>
                  <Button variant="outline" size="sm">Edit</Button>
                </div>
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-medium">Manager User</p>
                    <p className="text-sm text-slate-600">manager@company.com</p>
                  </div>
                  <Button variant="outline" size="sm">Edit</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="procedures">
          <Card>
            <CardHeader>
              <CardTitle>Procedure Catalog</CardTitle>
              <CardDescription>Configure services and pricing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label>Service Name</Label>
                  <Input placeholder="e.g., Business License" className="mt-1" />
                </div>
                <div>
                  <Label>Base Price (AED)</Label>
                  <Input type="number" placeholder="5000" className="mt-1" />
                </div>
                <Button>Add Service</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commission">
          <Card>
            <CardHeader>
              <CardTitle>Commission Rules</CardTitle>
              <CardDescription>Configure commission calculation rules</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label>Commission Type</Label>
                  <select className="w-full mt-1 p-2 border rounded-lg">
                    <option>Percentage of Sales</option>
                    <option>Fixed Amount</option>
                    <option>Tiered</option>
                  </select>
                </div>
                <div>
                  <Label>Default Rate (%)</Label>
                  <Input type="number" placeholder="5" className="mt-1" />
                </div>
                <Button>Save Rules</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="banking">
          <Card>
            <CardHeader>
              <CardTitle>Bank Cards & Balances</CardTitle>
              <CardDescription>Manage bank accounts and card details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label>Bank Name</Label>
                  <Input placeholder="e.g., Emirates NBD" className="mt-1" />
                </div>
                <div>
                  <Label>Card Last 4 Digits</Label>
                  <Input placeholder="1234" maxLength={4} className="mt-1" />
                </div>
                <Button>Add Card</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits">
          <Card>
            <CardHeader>
              <CardTitle>Debt Limits & Alert Thresholds</CardTitle>
              <CardDescription>Configure credit limits and warning alerts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label>Default Credit Limit (AED)</Label>
                  <Input type="number" placeholder="10000" className="mt-1" />
                </div>
                <div>
                  <Label>Warning Threshold (%)</Label>
                  <Input type="number" placeholder="80" className="mt-1" />
                </div>
                <Button>Save Settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
