import { Migration } from '@mikro-orm/migrations';

export class Migration20261122000737 extends Migration {
  override name = 'Migration20261122000737';

  override up(): void | Promise<void> {
    // expires_at is added nullable and backfilled from the row's own
    // created_at (the one-clock-reading rule, ADR-041) before SET NOT NULL,
    // so the migration never fails on pre-existing rows.
    this.addSql(
      `alter table "enrollments" add "public_id" uuid not null default uuidv7(), add "status" text not null default 'INITIAL', add "current_step" text not null default 'NATIONAL_CODE', add "expires_at" timestamptz(3) null;`,
    );
    this.addSql(`update "enrollments" set "expires_at" = "created_at" + interval '24 hours';`);
    this.addSql(`alter table "enrollments" alter column "expires_at" set not null;`);
    // The phone narrowing is safe because the table is empty (verified in
    // this task) and no application writer existed between the migrations:
    // an explicit cast to varchar(n) silently truncates over-length values,
    // so replaying against populated data would need a guard first.
    this.addSql(
      `alter table "enrollments" alter column "phone_number" type varchar(11) using ("phone_number"::varchar(11));`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_public_id_unique" unique ("public_id");`,
    );
    this.addSql(
      `create unique index "enrollments_phone_active_unique" on "enrollments" ("phone_number") where status <> 'EXPIRED';`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_current_step_valid" check (current_step in ('NATIONAL_CODE', 'FULL_NAME', 'BIRTH_DATE', 'REFERRAL_CODE', 'USERNAME', 'PASSWORD', 'OCCUPATION', 'VIDEO_VERIFICATION', 'COMPLETED'));`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_status_valid" check (status in ('INITIAL', 'IN_PROGRESS', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'EXPIRED'));`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_public_id_uuidv7" check (uuid_extract_version(public_id) = 7);`,
    );
    this.addSql(
      `alter table "enrollments" add constraint "enrollments_phone_number_format" check (phone_number ~ '^09[0-9]{9}\$');`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "enrollments" drop constraint "enrollments_public_id_unique";`);
    this.addSql(`drop index "enrollments_phone_active_unique";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_current_step_valid";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_status_valid";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_public_id_uuidv7";`);
    this.addSql(`alter table "enrollments" drop constraint "enrollments_phone_number_format";`);
    this.addSql(
      `alter table "enrollments" drop column "public_id", drop column "status", drop column "current_step", drop column "expires_at";`,
    );
    this.addSql(
      `alter table "enrollments" alter column "phone_number" type varchar(255) using ("phone_number"::varchar(255));`,
    );
  }
}
