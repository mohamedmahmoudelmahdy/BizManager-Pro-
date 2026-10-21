import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, homePathForRole } from '@/app/contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';

export function LoginPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextUser = await login(username, password);

    if (nextUser) {
      toast.success(t('login.loginSuccess'));
      navigate(homePathForRole(nextUser.role));
    } else {
      toast.error(t('login.loginError'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-8 items-center">
        {/* Branding Panel */}
        <div className="hidden md:block">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-600 rounded-xl">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">{t('appName')}</h1>
                <p className="text-slate-600">{t('appTagline')}</p>
              </div>
            </div>
            
            <div className="space-y-4 mt-8">
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <h3 className="font-semibold text-slate-900 mb-2">{t('login.centralizeTitle')}</h3>
                <p className="text-sm text-slate-600">{t('login.centralizeDesc')}</p>
              </div>
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <h3 className="font-semibold text-slate-900 mb-2">{t('login.traceTitle')}</h3>
                <p className="text-sm text-slate-600">{t('login.traceDesc')}</p>
              </div>
              <div className="p-4 bg-white rounded-lg shadow-sm">
                <h3 className="font-semibold text-slate-900 mb-2">{t('login.rolesTitle')}</h3>
                <p className="text-sm text-slate-600">{t('login.rolesDesc')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Login Form */}
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle>{t('login.welcomeBack')}</CardTitle>
            <CardDescription>{t('login.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('login.username')}</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder={t('login.enterUsername')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={t('login.enterPassword')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full">
                {t('login.login')}
              </Button>

            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
