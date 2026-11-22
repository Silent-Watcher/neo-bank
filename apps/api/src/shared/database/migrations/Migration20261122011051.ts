import { Migration } from '@mikro-orm/migrations';

export class Migration20261122011051 extends Migration {
  override name = 'Migration20261122011051';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table "enrollments" add "national_code" varchar(10) null, add "first_name" text null, add "last_name" text null, add "birth_date" date null, add "referral_code" text null, add "username" text null, add "password_hash" text null, add "occupation" text null, add "video_key" text null;`,
    );
    this.addSql(
      `create unique index "enrollments_username_active_unique" on "enrollments" ("username") where username IS NOT NULL AND status <> 'EXPIRED';`,
    );
    this.addSql(
      `create unique index "enrollments_national_code_active_unique" on "enrollments" ("national_code") where national_code IS NOT NULL AND status <> 'EXPIRED';`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_video_key_length" check (char_length(video_key) <= 500);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_occupation_length" check (char_length(occupation) <= 100);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_referral_code_length" check (char_length(referral_code) <= 20);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_last_name_length" check (char_length(last_name) <= 50);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_first_name_length" check (char_length(first_name) <= 50);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_username_format" check (username ~ '^[a-z0-9._-]{3,30}\$');`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_national_code_format" check (national_code ~ '^[0-9]{10}\$');`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "enrollments_username_active_unique";`);
    this.addSql(`drop index "enrollments_national_code_active_unique";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_video_key_length";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_occupation_length";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_referral_code_length";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_last_name_length";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_first_name_length";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_username_format";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_national_code_format";`);
    this.addSql(
      `alter table "enrollments" drop column "national_code", drop column "first_name", drop column "last_name", drop column "birth_date", drop column "referral_code", drop column "username", drop column "password_hash", drop column "occupation", drop column "video_key";`,
    );
  }
}
