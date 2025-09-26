import React, { useState } from 'react';
import { Button } from './ui/Button';
import { HelpCircle } from 'lucide-react';
import { InfoModal } from './InfoModal';

export const Header: React.FC = () => {
  const [showInfoModal, setShowInfoModal] = useState(false);

  return (
    <>
      <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-gray-100 hidden md:block">
              DRESSUP | AI画像編集ツール
            </h1>
            <h1 className="text-xl font-semibold text-gray-900 md:hidden">
              NB Editor
            </h1>
          </div>
          <div className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
            1.0
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setShowInfoModal(true)}
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </header>
      
      <InfoModal open={showInfoModal} onOpenChange={setShowInfoModal} />
    </>
  );
};
