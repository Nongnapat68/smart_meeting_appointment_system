import { SignUpForm } from "./SignUpForm";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-gutter">
      <main className="bg-surface-container-lowest w-full max-w-md rounded-xl ambient-shadow p-card-padding sm:p-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-primary-container/10 rounded-lg flex items-center justify-center mb-4 text-primary">
            <span className="material-symbols-outlined icon-fill text-4xl">calendar_month</span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-primary text-center">สร้างบัญชี Smart Meeting</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-2 text-center">
            เริ่มจัดการการประชุมและงานของทีมได้ทันที
          </p>
        </div>
        <SignUpForm />
      </main>
    </div>
  );
}
