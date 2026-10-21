import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/app/i18n';
import { useAuth } from '@/app/contexts/AuthContext';
import { useData } from '@/app/contexts/DataContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Search, Bell, Plus, LogOut, User } from 'lucide-react';
import { Badge } from '@/app/components/ui/badge';

export function TopBar() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { globalSearchQuery, setGlobalSearchQuery } = useData();
  const navigate = useNavigate();
  const [showQuickAction, setShowQuickAction] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Mock notifications
  const notifications = [
    { id: 1, title: t('notifications.licenseExpiring'), desc: 'Tech Solutions LLC', time: t('notifications.timeHoursAgo', { count: 2 }) },
    { id: 2, title: t('notifications.newProcedure'), desc: 'Ahmed Hassan', time: t('notifications.timeHoursAgo', { count: 5 }) },
    { id: 3, title: t('notifications.paymentReceived'), desc: 'AED 5,000', time: t('notifications.timeDaysAgo', { count: 1 }) },
  ];

  return (
    <>
      <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
        {/* Search */}
        <div className="flex-1 max-w-2xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder={t('topbar.searchPlaceholder')}
              className="pl-10 bg-slate-50 border-slate-200"
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Quick Action Button */}
          <Button onClick={() => setShowQuickAction(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('topbar.new')}</span>
          </Button>

          <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={t('topbar.language')}>
            <button
              type="button"
              onClick={() => i18n.changeLanguage('en')}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                i18n.language === 'en' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('topbar.languageEnglish')}
            </button>
            <button
              type="button"
              onClick={() => i18n.changeLanguage('ar')}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                i18n.language === 'ar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('topbar.languageArabic')}
            </button>
          </div>

          <Button variant="outline" className="gap-2" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('topbar.signOut')}</span>
          </Button>

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="h-5 w-5" />
                <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs">
                  {notifications.length}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>{t('topbar.notifications')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.map((notification) => (
                <DropdownMenuItem key={notification.id} className="flex flex-col items-start p-3">
                  <div className="font-medium">{notification.title}</div>
                  <div className="text-sm text-slate-500">{notification.desc}</div>
                  <div className="text-xs text-slate-400 mt-1">{notification.time}</div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <span className="text-sm font-semibold text-white">{user?.name.charAt(0)}</span>
                </div>
                <div className="hidden md:block text-left">
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs text-slate-500 capitalize">{user?.role}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t('topbar.myAccount')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                {t('topbar.profile')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                {t('topbar.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Quick Action Dialog */}
      <Dialog open={showQuickAction} onOpenChange={setShowQuickAction}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('topbar.quickActions')}</DialogTitle>
            <DialogDescription>{t('topbar.quickActionsDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-4">
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => {
                setShowQuickAction(false);
                navigate('/procedures');
              }}
            >
              <Plus className="h-6 w-6" />
              {t('topbar.newProcedure')}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => {
                setShowQuickAction(false);
                navigate('/customers');
              }}
            >
              <Plus className="h-6 w-6" />
              {t('topbar.newCustomer')}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => {
                setShowQuickAction(false);
                navigate('/payments');
              }}
            >
              <Plus className="h-6 w-6" />
              {t('topbar.newPayment')}
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => {
                setShowQuickAction(false);
                navigate('/expenses/new');
              }}
            >
              <Plus className="h-6 w-6" />
              {t('topbar.newExpense')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
