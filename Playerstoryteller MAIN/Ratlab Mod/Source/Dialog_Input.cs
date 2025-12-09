using System;
using UnityEngine;
using Verse;

namespace PlayerStoryteller
{
    public class Dialog_Input : Window
    {
        private string header;
        private string label;
        private Action<string> confirmAction;
        private string curInput;

        public override Vector2 InitialSize => new Vector2(400f, 200f);

        public Dialog_Input(string header, string label, Action<string> confirmAction)
        {
            this.header = header;
            this.label = label;
            this.confirmAction = confirmAction;
            this.curInput = "";
            this.forcePause = true;
            this.closeOnClickedOutside = true;
            this.absorbInputAroundWindow = true;
        }

        public override void DoWindowContents(Rect inRect)
        {
            Text.Font = GameFont.Medium;
            Widgets.Label(new Rect(0f, 0f, inRect.width, 35f), header);
            Text.Font = GameFont.Small;
            
            Widgets.Label(new Rect(0f, 40f, inRect.width, 30f), label);
            
            curInput = Widgets.TextField(new Rect(0f, 75f, inRect.width, 35f), curInput);

            if (Widgets.ButtonText(new Rect(0f, 125f, inRect.width / 2f - 10f, 35f), "Confirm", true, true, true))
            {
                confirmAction?.Invoke(curInput);
                Close();
            }
            
            if (Widgets.ButtonText(new Rect(inRect.width / 2f + 10f, 125f, inRect.width / 2f - 10f, 35f), "Cancel", true, true, true))
            {
                Close();
            }
        }
    }
}
